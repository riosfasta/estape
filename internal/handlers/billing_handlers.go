package handlers

import (
	"context"
	"fmt"
	"html"
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

const purchaseAlertRecipientEmail = "rioswebdev@gmail.com"

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
		Name               *string `json:"name"`
		Description        *string `json:"description"`
		PricingModel       *string `json:"pricing_model"`
		Price              *int64  `json:"price"`
		PriceYearly        *int64  `json:"price_yearly"`
		PricePerSeat       *int64  `json:"price_per_seat"`
		PricePerSeatYearly *int64  `json:"price_per_seat_yearly"`
		TrialDays          *int    `json:"trial_days"`
		SeatLimit          *int    `json:"seat_limit"`
		ProjectLimit       *int    `json:"project_limit"`
		StorageLimitMB     *int    `json:"storage_limit_mb"`
		Featured           *bool   `json:"featured"`
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
	if req.PriceYearly != nil {
		if *req.PriceYearly < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price_yearly cannot be negative"})
			return
		}
		set["price_yearly"] = *req.PriceYearly
		current.PriceYearly = *req.PriceYearly
	}
	if req.PricePerSeat != nil {
		if *req.PricePerSeat < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price_per_seat cannot be negative"})
			return
		}
		set["price_per_seat"] = *req.PricePerSeat
		current.PricePerSeat = *req.PricePerSeat
	}
	if req.PricePerSeatYearly != nil {
		if *req.PricePerSeatYearly < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price_per_seat_yearly cannot be negative"})
			return
		}
		set["price_per_seat_yearly"] = *req.PricePerSeatYearly
		current.PricePerSeatYearly = *req.PricePerSeatYearly
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

func normalizedBillingPeriod(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "year", "yearly", "annual", "annually":
		return "yearly"
	default:
		return "monthly"
	}
}

func normalizedBillingQuantity(value int) int {
	if value < 1 {
		return 1
	}
	if value > 120 {
		return 120
	}
	return value
}

func billingExpiry(start time.Time, period string, quantity int) time.Time {
	if normalizedBillingPeriod(period) == "yearly" {
		return start.AddDate(normalizedBillingQuantity(quantity), 0, 0)
	}
	return start.AddDate(0, normalizedBillingQuantity(quantity), 0)
}

func planBillingAmount(plan models.Plan, seatCount int64, period string, quantity int) int64 {
	if seatCount < 1 {
		seatCount = 1
	}
	quantity = normalizedBillingQuantity(quantity)
	period = normalizedBillingPeriod(period)
	unit := plan.Price
	if plan.PricingModel == "per_seat" {
		unit = plan.PricePerSeat
		if period == "yearly" {
			unit = plan.PricePerSeatYearly
			if unit <= 0 {
				unit = plan.PricePerSeat * 12
			}
		}
		return unit * seatCount * int64(quantity)
	}
	if period == "yearly" {
		unit = plan.PriceYearly
		if unit <= 0 {
			unit = plan.Price * 12
		}
	}
	return unit * int64(quantity)
}

func teamSeatCount(team models.Team) int64 {
	count := int64(len(team.MemberIDs))
	if count < 1 {
		return 1
	}
	return count
}

func formatBillingAmountCents(amount int64) string {
	sign := ""
	if amount < 0 {
		sign = "-"
		amount = -amount
	}
	return fmt.Sprintf("%s$%d.%02d USD", sign, amount/100, amount%100)
}

func purchaseAlertRow(label string, value string) string {
	if strings.TrimSpace(value) == "" {
		value = "-"
	}
	return `<tr><th style="text-align:left;padding:8px 12px;border-bottom:1px solid #d7e4df;color:#45645e;">` +
		html.EscapeString(label) +
		`</th><td style="padding:8px 12px;border-bottom:1px solid #d7e4df;color:#10211d;">` +
		html.EscapeString(value) +
		`</td></tr>`
}

func (s *Server) enqueuePurchaseAlertEmail(ctx context.Context, buyer models.User, team models.Team, plan models.Plan, sub models.Subscription, amount int64, seatCount int64) {
	if s.mailer == nil {
		return
	}
	buyerName := firstNonEmpty(buyer.Name, buyer.Username, buyer.Email, "Unknown user")
	appName := firstNonEmpty(s.cfg.AppName, "bugmega")
	adminURL := strings.TrimRight(s.cfg.AppURL, "/") + "/admin/users"
	body := `<p>A user completed the purchase checkout handoff. The subscription is waiting for platform owner activation.</p>` +
		`<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #d7e4df;border-radius:8px;overflow:hidden;">` +
		purchaseAlertRow("User name", buyerName) +
		purchaseAlertRow("Username", buyer.Username) +
		purchaseAlertRow("User email", buyer.Email) +
		purchaseAlertRow("User ID", buyer.ID.Hex()) +
		purchaseAlertRow("Account role", string(buyer.Role)) +
		purchaseAlertRow("Staff role", staffRoleDisplayName(buyer.StaffRole)) +
		purchaseAlertRow("Company/team", firstNonEmpty(team.Name, "Unknown company")) +
		purchaseAlertRow("Company email", team.CompanyEmail) +
		purchaseAlertRow("Team ID", team.ID.Hex()) +
		purchaseAlertRow("Current seat count", fmt.Sprintf("%d", seatCount)) +
		purchaseAlertRow("Plan", plan.Name) +
		purchaseAlertRow("Plan ID", plan.ID.Hex()) +
		purchaseAlertRow("Pricing model", plan.PricingModel) +
		purchaseAlertRow("Billing period", sub.BillingPeriod) +
		purchaseAlertRow("Billing quantity", fmt.Sprintf("%d", normalizedBillingQuantity(sub.BillingQuantity))) +
		purchaseAlertRow("Payment method", sub.PaymentProvider) +
		purchaseAlertRow("Checkout/payment reference", sub.ExternalTransactionID) +
		purchaseAlertRow("Amount", formatBillingAmountCents(amount)) +
		purchaseAlertRow("Subscription status", sub.Status) +
		purchaseAlertRow("Subscription ID", sub.ID.Hex()) +
		purchaseAlertRow("Created at", sub.CreatedAt.Format("Jan 2, 2006 3:04 PM MST")) +
		`</table>` +
		`<p><a href="` + html.EscapeString(adminURL) + `">Open platform manage users</a></p>`
	_ = s.mailer.Enqueue(ctx, models.EmailQueueItem{
		Recipient: purchaseAlertRecipientEmail,
		Type:      "subscription_purchase_alert",
		Subject:   appName + " purchase pending activation: " + buyerName,
		BodyHTML:  body,
	})
}

func (s *Server) purchaseSubscription(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		PlanID        string `json:"plan_id"`
		Provider      string `json:"provider"`
		BillingPeriod string `json:"billing_period"`
		Quantity      int    `json:"quantity"`
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
	if !s.paymentProviderEnabled(c.Request.Context(), providerName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": providerName + " payments are disabled in platform settings"})
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
	period := normalizedBillingPeriod(req.BillingPeriod)
	quantity := normalizedBillingQuantity(req.Quantity)
	pending, err := s.store.C("subscriptions").CountDocuments(c.Request.Context(), bson.M{"team_id": userCtx.TeamID, "status": "pending_approval"})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check pending subscriptions"})
		return
	}
	if pending > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "a subscription purchase is already pending approval"})
		return
	}

	var team models.Team
	_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team)
	if team.ID.IsZero() {
		team.ID = userCtx.TeamID
	}
	buyer, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		buyer = models.User{ID: userCtx.ID, Role: userCtx.Role, TeamID: userCtx.TeamID}
	}
	seatCount := teamSeatCount(team)
	amount := planBillingAmount(plan, seatCount, period, quantity)
	session, err := provider.CreateCheckout(c.Request.Context(), billing.CheckoutRequest{TeamID: userCtx.TeamID.Hex(), PlanID: plan.ID.Hex(), Amount: amount, Currency: "usd"})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not create checkout"})
		return
	}
	now := time.Now()
	sub := models.Subscription{
		ID:                    primitive.NewObjectID(),
		TeamID:                userCtx.TeamID,
		PlanID:                plan.ID,
		Status:                "pending_approval",
		BillingPeriod:         period,
		BillingQuantity:       quantity,
		PaymentProvider:       provider.Name(),
		ExternalTransactionID: session.ExternalID,
		StartedAt:             now,
		CreatedAt:             now,
	}
	if _, err := s.store.C("subscriptions").InsertOne(c.Request.Context(), sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create subscription"})
		return
	}
	_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), userCtx.TeamID, bson.M{"$set": bson.M{"subscription_id": sub.ID, "seat_limit_cached": plan.SeatLimit}})
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	s.notifyOwnerAdmins(c.Request.Context(), userCtx.ID, "subscription_purchase", actor+" started a "+period+" purchase for "+plan.Name+".", sub.ID)
	s.enqueuePurchaseAlertEmail(c.Request.Context(), buyer, team, plan, sub, amount, seatCount)
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
	period := normalizedBillingPeriod(sub.BillingPeriod)
	quantity := normalizedBillingQuantity(sub.BillingQuantity)
	var team models.Team
	_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": sub.TeamID}).Decode(&team)
	amount := planBillingAmount(plan, teamSeatCount(team), period, quantity)
	now := time.Now()
	expires := billingExpiry(now, period, quantity)
	_, err := s.store.C("subscriptions").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"status": "active", "billing_period": period, "billing_quantity": quantity, "approved_by": userCtx.ID, "started_at": now, "expires_at": expires}})
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
