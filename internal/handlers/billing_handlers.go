package handlers

import (
	"io"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/billing"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) listPlans(c *gin.Context) {
	cursor, err := s.store.C("plans").Find(c.Request.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "price", Value: 1}, {Key: "price_per_seat", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load plans"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var plans []models.Plan
	if err := cursor.All(c.Request.Context(), &plans); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode plans"})
		return
	}
	if plans == nil {
		plans = []models.Plan{}
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func (s *Server) adminUpdatePlan(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		Name           *string `json:"name"`
		Description    *string `json:"description"`
		PricingModel   *string `json:"pricing_model"`
		Price          *int64  `json:"price"`
		PricePerSeat   *int64  `json:"price_per_seat"`
		TrialDays      *int    `json:"trial_days"`
		SeatLimit      *int    `json:"seat_limit"`
		ProjectLimit   *int    `json:"project_limit"`
		StorageLimitMB *int    `json:"storage_limit_mb"`
		Featured       *bool   `json:"featured"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan update"})
		return
	}

	var current models.Plan
	if err := s.store.C("plans").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&current); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
		return
	}

	set := bson.M{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "plan name is required"})
			return
		}
		set["name"] = name
		current.Name = name
	}
	if req.Description != nil {
		set["description"] = strings.TrimSpace(*req.Description)
		current.Description = strings.TrimSpace(*req.Description)
	}
	if req.PricingModel != nil {
		model := strings.TrimSpace(*req.PricingModel)
		if model != "flat" && model != "per_seat" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pricing_model must be flat or per_seat"})
			return
		}
		set["pricing_model"] = model
		current.PricingModel = model
	}
	if req.Price != nil {
		if *req.Price < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price cannot be negative"})
			return
		}
		set["price"] = *req.Price
		current.Price = *req.Price
	}
	if req.PricePerSeat != nil {
		if *req.PricePerSeat < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price_per_seat cannot be negative"})
			return
		}
		set["price_per_seat"] = *req.PricePerSeat
		current.PricePerSeat = *req.PricePerSeat
	}
	if req.TrialDays != nil {
		if *req.TrialDays < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "trial_days cannot be negative"})
			return
		}
		set["trial_days"] = *req.TrialDays
		current.TrialDays = *req.TrialDays
	}
	if req.SeatLimit != nil {
		if *req.SeatLimit < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "seat_limit must be at least 1"})
			return
		}
		set["seat_limit"] = *req.SeatLimit
		current.SeatLimit = *req.SeatLimit
	}
	if req.ProjectLimit != nil {
		if *req.ProjectLimit < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_limit must be at least 1"})
			return
		}
		set["project_limit"] = *req.ProjectLimit
		current.ProjectLimit = *req.ProjectLimit
	}
	if req.StorageLimitMB != nil {
		if *req.StorageLimitMB < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "storage_limit_mb must be at least 1"})
			return
		}
		set["storage_limit_mb"] = *req.StorageLimitMB
		current.StorageLimitMB = *req.StorageLimitMB
	}
	if req.Featured != nil {
		set["featured"] = *req.Featured
		current.Featured = *req.Featured
	}
	if current.PricingModel == "flat" && current.Price <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "flat plans need a price greater than zero"})
		return
	}
	if current.PricingModel == "per_seat" && current.PricePerSeat <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "per-seat plans need a price_per_seat greater than zero"})
		return
	}
	if len(set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}

	if current.Featured {
		_, _ = s.store.C("plans").UpdateMany(c.Request.Context(), bson.M{"_id": bson.M{"$ne": id}}, bson.M{"$set": bson.M{"featured": false}})
	}
	if _, err := s.store.C("plans").UpdateByID(c.Request.Context(), id, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update plan"})
		return
	}
	subscriptionIDs, err := s.subscriptionIDsForPlan(c, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "plan updated, but subscription lookup failed"})
		return
	}
	if len(subscriptionIDs) > 0 {
		if _, err := s.store.C("teams").UpdateMany(
			c.Request.Context(),
			bson.M{"subscription_id": bson.M{"$in": subscriptionIDs}},
			bson.M{"$set": bson.M{"seat_limit_cached": current.SeatLimit}},
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "plan updated, but seat cache refresh failed"})
			return
		}
	}
	s.audit(c.Request.Context(), userCtx.ID, "plan.updated", "plan", id)
	c.JSON(http.StatusOK, gin.H{"updated": true, "plan": current})
}

func (s *Server) subscriptionIDsForPlan(c *gin.Context, planID primitive.ObjectID) ([]primitive.ObjectID, error) {
	cursor, err := s.store.C("subscriptions").Find(c.Request.Context(), bson.M{"plan_id": planID})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(c.Request.Context())

	ids := []primitive.ObjectID{}
	for cursor.Next(c.Request.Context()) {
		var sub models.Subscription
		if err := cursor.Decode(&sub); err != nil {
			return nil, err
		}
		ids = append(ids, sub.ID)
	}
	return ids, cursor.Err()
}

func (s *Server) purchaseSubscription(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		PlanID   string `json:"plan_id"`
		Provider string `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription body"})
		return
	}
	providerName := strings.ToLower(strings.TrimSpace(req.Provider))
	provider, ok := s.payments[providerName]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider must be stripe or paypal; Google Pay is enabled inside those providers"})
		return
	}
	planID, err := objectIDFromString(req.PlanID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan_id"})
		return
	}
	var plan models.Plan
	if err := s.store.C("plans").FindOne(c.Request.Context(), bson.M{"_id": planID}).Decode(&plan); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
		return
	}
	pending, err := s.store.C("subscriptions").CountDocuments(c.Request.Context(), bson.M{"team_id": userCtx.TeamID, "status": "pending_approval"})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check pending subscriptions"})
		return
	}
	if pending > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "a subscription purchase is already pending approval"})
		return
	}

	amount := plan.Price
	if plan.PricingModel == "per_seat" {
		var team models.Team
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team)
		seatCount := int64(len(team.MemberIDs))
		if seatCount == 0 {
			seatCount = 1
		}
		amount = plan.PricePerSeat * seatCount
	}
	session, err := provider.CreateCheckout(c.Request.Context(), billing.CheckoutRequest{TeamID: userCtx.TeamID.Hex(), PlanID: plan.ID.Hex(), Amount: amount, Currency: "usd"})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not create checkout"})
		return
	}
	now := time.Now()
	status := "pending_approval"
	var trialEnds *time.Time
	if plan.TrialDays > 0 {
		status = "trialing"
		end := now.AddDate(0, 0, plan.TrialDays)
		trialEnds = &end
	}
	sub := models.Subscription{
		ID:                    primitive.NewObjectID(),
		TeamID:                userCtx.TeamID,
		PlanID:                plan.ID,
		Status:                status,
		PaymentProvider:       provider.Name(),
		ExternalTransactionID: session.ExternalID,
		TrialEndsAt:           trialEnds,
		StartedAt:             now,
		CreatedAt:             now,
	}
	if _, err := s.store.C("subscriptions").InsertOne(c.Request.Context(), sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create subscription"})
		return
	}
	_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), userCtx.TeamID, bson.M{"$set": bson.M{"subscription_id": sub.ID, "seat_limit_cached": plan.SeatLimit}})
	c.JSON(http.StatusCreated, gin.H{"subscription": sub, "checkout": session, "amount": amount})
}

func (s *Server) listInvoices(c *gin.Context) {
	teamID, ok := objectIDParam(c, "teamId")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	cursor, err := s.store.C("invoices").Find(c.Request.Context(), bson.M{"team_id": teamID}, options.Find().SetSort(bson.D{{Key: "issued_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load invoices"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var invoices []models.Invoice
	if err := cursor.All(c.Request.Context(), &invoices); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode invoices"})
		return
	}
	if invoices == nil {
		invoices = []models.Invoice{}
	}
	c.JSON(http.StatusOK, gin.H{"invoices": invoices})
}

func (s *Server) paymentWebhook(providerName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provider, ok := s.payments[providerName]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown provider"})
			return
		}
		body, _ := io.ReadAll(c.Request.Body)
		event, err := provider.HandleWebhook(c.Request.Context(), body, map[string]string{"signature": c.GetHeader("Stripe-Signature") + c.GetHeader("Paypal-Transmission-Sig")})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "webhook rejected"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"received": true, "event": event})
	}
}

func (s *Server) approveSubscription(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var sub models.Subscription
	if err := s.store.C("subscriptions").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&sub); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
		return
	}
	var plan models.Plan
	if err := s.store.C("plans").FindOne(c.Request.Context(), bson.M{"_id": sub.PlanID}).Decode(&plan); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
		return
	}
	amount := plan.Price
	if plan.PricingModel == "per_seat" {
		var team models.Team
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": sub.TeamID}).Decode(&team)
		seatCount := int64(len(team.MemberIDs))
		if seatCount == 0 {
			seatCount = 1
		}
		amount = plan.PricePerSeat * seatCount
	}
	now := time.Now()
	expires := now.AddDate(0, 1, 0)
	_, err := s.store.C("subscriptions").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"status": "active", "approved_by": userCtx.ID, "started_at": now, "expires_at": expires}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not approve subscription"})
		return
	}
	invoice := models.Invoice{
		ID:                 primitive.NewObjectID(),
		TeamID:             sub.TeamID,
		SubscriptionID:     sub.ID,
		Amount:             amount,
		Currency:           "usd",
		Status:             "paid",
		PaymentProvider:    sub.PaymentProvider,
		ExternalInvoiceURL: s.cfg.AppURL + "/settings/billing#invoice-" + sub.ID.Hex(),
		IssuedAt:           now,
	}
	_, _ = s.store.C("invoices").InsertOne(c.Request.Context(), invoice)
	s.audit(c.Request.Context(), userCtx.ID, "subscription.approved", "subscription", id)
	c.JSON(http.StatusOK, gin.H{"approved": true, "invoice": invoice})
}
