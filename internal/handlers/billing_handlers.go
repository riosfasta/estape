package handlers

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
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
		if model != "" && model != "flat" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only flat package pricing is supported"})
			return
		}
		set["pricing_model"] = "flat"
		current.PricingModel = "flat"
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
	if current.PricingModel != "flat" {
		set["pricing_model"] = "flat"
		current.PricingModel = "flat"
	}
	set["price_per_seat"] = int64(0)
	set["price_per_seat_yearly"] = int64(0)
	current.PricePerSeat = 0
	current.PricePerSeatYearly = 0
	if current.Price <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "flat plans need a price greater than zero"})
		return
	}
	if current.PriceYearly <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "flat plans need a yearly price greater than zero"})
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

func (s *Server) payPalCheckoutBase(ctx context.Context) (billing.CheckoutRequest, error) {
	settings, err := s.loadSiteSettings(ctx)
	if err != nil {
		settings = s.defaultSiteSettings(time.Now())
	}
	settings = s.settingsWithConfigFallback(settings)
	if !settings.PayPalEnabled {
		return billing.CheckoutRequest{}, errors.New("paypal checkout is disabled")
	}
	if strings.TrimSpace(settings.PayPalClientID) == "" || strings.TrimSpace(settings.PayPalClientSecret) == "" {
		return billing.CheckoutRequest{}, errors.New("paypal client id and secret are required")
	}
	return billing.CheckoutRequest{
		ClientID:     strings.TrimSpace(settings.PayPalClientID),
		ClientSecret: strings.TrimSpace(settings.PayPalClientSecret),
		Mode:         firstNonEmpty(settings.PayPalMode, "sandbox"),
		BrandName:    firstNonEmpty(settings.SiteName, s.cfg.AppName, "BugMega"),
	}, nil
}

func (s *Server) appAbsoluteURL(path string) string {
	base := strings.TrimRight(s.cfg.AppURL, "/")
	if base == "" {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

func (s *Server) payPalReturnURL(subscriptionID primitive.ObjectID) string {
	values := url.Values{}
	values.Set("subscription_id", subscriptionID.Hex())
	return s.appAbsoluteURL("/api/paypal/return?" + values.Encode())
}

func (s *Server) payPalCancelURL(subscriptionID primitive.ObjectID) string {
	values := url.Values{}
	values.Set("subscription_id", subscriptionID.Hex())
	return s.appAbsoluteURL("/api/paypal/cancel?" + values.Encode())
}

func (s *Server) billingPaymentRedirect(status string, message string, invoiceID primitive.ObjectID) string {
	values := url.Values{}
	values.Set("payment", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	target := s.appAbsoluteURL("/settings/billing?" + values.Encode())
	if !invoiceID.IsZero() {
		target += "#invoice-" + invoiceID.Hex()
	}
	return target
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
	body := `<p>A user purchased the PayPal package. The subscription was activated automatically.</p>` +
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
		Subject:   appName + " PayPal purchase: " + buyerName,
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
	if providerName == "" {
		providerName = "paypal"
	}
	if providerName != "paypal" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PayPal is the only supported payment method"})
		return
	}
	provider, ok := s.payments[providerName]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PayPal checkout is not available"})
		return
	}
	if !s.paymentProviderEnabled(c.Request.Context(), providerName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PayPal payments are disabled in platform settings"})
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

	var team models.Team
	_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team)
	if team.ID.IsZero() {
		team.ID = userCtx.TeamID
	}
	seatCount := teamSeatCount(team)
	amount := planBillingAmount(plan, seatCount, period, quantity)
	now := time.Now()
	_, _ = s.store.C("subscriptions").UpdateMany(
		c.Request.Context(),
		bson.M{"team_id": userCtx.TeamID, "status": "pending_payment"},
		bson.M{"$set": bson.M{"status": "cancelled", "expires_at": now}},
	)
	sub := models.Subscription{
		ID:              primitive.NewObjectID(),
		TeamID:          userCtx.TeamID,
		PlanID:          plan.ID,
		Status:          "pending_payment",
		BillingPeriod:   period,
		BillingQuantity: quantity,
		PaymentProvider: provider.Name(),
		BuyerID:         userCtx.ID,
		StartedAt:       now,
		CreatedAt:       now,
	}
	if _, err := s.store.C("subscriptions").InsertOne(c.Request.Context(), sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create subscription"})
		return
	}
	checkoutReq, err := s.payPalCheckoutBase(c.Request.Context())
	if err != nil {
		_, _ = s.store.C("subscriptions").UpdateByID(c.Request.Context(), sub.ID, bson.M{"$set": bson.M{"status": "checkout_failed", "expires_at": now}})
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	checkoutReq.TeamID = userCtx.TeamID.Hex()
	checkoutReq.PlanID = plan.ID.Hex()
	checkoutReq.Amount = amount
	checkoutReq.Currency = "usd"
	checkoutReq.CustomID = sub.ID.Hex()
	checkoutReq.InvoiceID = "bugmega-" + sub.ID.Hex()
	checkoutReq.Description = fmt.Sprintf("%s %s package", plan.Name, period)
	checkoutReq.ReturnURL = s.payPalReturnURL(sub.ID)
	checkoutReq.CancelURL = s.payPalCancelURL(sub.ID)
	session, err := provider.CreateCheckout(c.Request.Context(), checkoutReq)
	if err != nil {
		_, _ = s.store.C("subscriptions").UpdateByID(c.Request.Context(), sub.ID, bson.M{"$set": bson.M{"status": "checkout_failed", "expires_at": now}})
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not create PayPal checkout"})
		return
	}
	sub.ExternalTransactionID = session.ExternalID
	if _, err := s.store.C("subscriptions").UpdateByID(c.Request.Context(), sub.ID, bson.M{"$set": bson.M{"external_transaction_id": session.ExternalID}}); err != nil {
		_, _ = s.store.C("subscriptions").UpdateByID(c.Request.Context(), sub.ID, bson.M{"$set": bson.M{"status": "checkout_failed", "expires_at": now}})
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save PayPal checkout"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subscription": sub, "checkout": session, "amount": amount})
}

func (s *Server) payPalCheckoutReturn(c *gin.Context) {
	orderID := strings.TrimSpace(c.Query("token"))
	if orderID == "" {
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "missing PayPal order token", primitive.NilObjectID))
		return
	}
	provider, ok := s.payments["paypal"]
	if !ok {
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "PayPal checkout is not available", primitive.NilObjectID))
		return
	}
	checkoutReq, err := s.payPalCheckoutBase(c.Request.Context())
	if err != nil {
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", err.Error(), primitive.NilObjectID))
		return
	}
	sub, err := s.findPayPalSubscription(c.Request.Context(), c.Query("subscription_id"), orderID)
	if err != nil {
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "checkout subscription was not found", primitive.NilObjectID))
		return
	}
	capture, err := provider.CaptureCheckout(c.Request.Context(), checkoutReq, orderID)
	if err != nil {
		s.markPayPalSubscriptionFailed(c.Request.Context(), c.Query("subscription_id"), orderID, "capture_failed")
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "PayPal capture failed", primitive.NilObjectID))
		return
	}
	if !strings.EqualFold(capture.Status, "COMPLETED") {
		s.markPayPalSubscriptionFailed(c.Request.Context(), c.Query("subscription_id"), orderID, "capture_incomplete")
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "PayPal payment was not completed", primitive.NilObjectID))
		return
	}
	invoice, err := s.activatePaidPayPalSubscription(c.Request.Context(), sub, capture)
	if err != nil {
		c.Redirect(http.StatusFound, s.billingPaymentRedirect("failed", "could not activate membership", primitive.NilObjectID))
		return
	}
	c.Redirect(http.StatusFound, s.billingPaymentRedirect("success", "", invoice.ID))
}

func (s *Server) payPalCheckoutCancel(c *gin.Context) {
	s.markPayPalSubscriptionFailed(c.Request.Context(), c.Query("subscription_id"), c.Query("token"), "cancelled")
	c.Redirect(http.StatusFound, s.billingPaymentRedirect("cancelled", "", primitive.NilObjectID))
}

func (s *Server) findPayPalSubscription(ctx context.Context, subscriptionID string, orderID string) (models.Subscription, error) {
	filter := bson.M{"payment_provider": "paypal"}
	if id, err := objectIDFromString(subscriptionID); err == nil {
		filter["_id"] = id
		if strings.TrimSpace(orderID) != "" {
			filter["external_transaction_id"] = strings.TrimSpace(orderID)
		}
	} else if strings.TrimSpace(orderID) != "" {
		filter["external_transaction_id"] = strings.TrimSpace(orderID)
	} else {
		return models.Subscription{}, errors.New("subscription id or order id is required")
	}
	var sub models.Subscription
	if err := s.store.C("subscriptions").FindOne(ctx, filter).Decode(&sub); err != nil {
		return models.Subscription{}, err
	}
	return sub, nil
}

func (s *Server) markPayPalSubscriptionFailed(ctx context.Context, subscriptionID string, orderID string, status string) {
	filter := bson.M{"payment_provider": "paypal", "status": bson.M{"$in": []string{"pending_payment", "checkout_failed", "capture_failed", "capture_incomplete"}}}
	if id, err := objectIDFromString(subscriptionID); err == nil {
		filter["_id"] = id
	} else if strings.TrimSpace(orderID) != "" {
		filter["external_transaction_id"] = strings.TrimSpace(orderID)
	} else {
		return
	}
	_, _ = s.store.C("subscriptions").UpdateOne(ctx, filter, bson.M{"$set": bson.M{"status": status, "expires_at": time.Now()}})
}

func (s *Server) activatePaidPayPalSubscription(ctx context.Context, sub models.Subscription, capture billing.PaymentCapture) (models.Invoice, error) {
	if !strings.EqualFold(capture.Status, "COMPLETED") {
		return models.Invoice{}, errors.New("paypal capture is not completed")
	}
	var existing models.Invoice
	if err := s.store.C("invoices").FindOne(ctx, bson.M{"subscription_id": sub.ID, "status": "paid"}).Decode(&existing); err == nil {
		return existing, nil
	}

	var plan models.Plan
	if err := s.store.C("plans").FindOne(ctx, bson.M{"_id": sub.PlanID}).Decode(&plan); err != nil {
		return models.Invoice{}, err
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": sub.TeamID}).Decode(&team); err != nil {
		return models.Invoice{}, err
	}
	period := normalizedBillingPeriod(sub.BillingPeriod)
	quantity := normalizedBillingQuantity(sub.BillingQuantity)
	amount := planBillingAmount(plan, teamSeatCount(team), period, quantity)
	now := time.Now()
	expires := billingExpiry(now, period, quantity)
	transactionID := firstNonEmpty(capture.ExternalID, sub.ExternalTransactionID)

	if _, err := s.store.C("subscriptions").UpdateByID(ctx, sub.ID, bson.M{"$set": bson.M{
		"status":                  "active",
		"billing_period":          period,
		"billing_quantity":        quantity,
		"external_transaction_id": transactionID,
		"started_at":              now,
		"expires_at":              expires,
	}}); err != nil {
		return models.Invoice{}, err
	}
	if _, err := s.store.C("teams").UpdateByID(ctx, sub.TeamID, bson.M{"$set": bson.M{"subscription_id": sub.ID, "seat_limit_cached": plan.SeatLimit}}); err != nil {
		return models.Invoice{}, err
	}

	invoice := models.Invoice{
		ID:                 primitive.NewObjectID(),
		TeamID:             sub.TeamID,
		SubscriptionID:     sub.ID,
		Amount:             amount,
		Currency:           "usd",
		Status:             "paid",
		PaymentProvider:    "paypal",
		ExternalInvoiceURL: s.appAbsoluteURL("/settings/billing#invoice-" + sub.ID.Hex()),
		IssuedAt:           now,
	}
	if _, err := s.store.C("invoices").InsertOne(ctx, invoice); err != nil {
		return models.Invoice{}, err
	}

	buyerID := sub.BuyerID
	if buyerID.IsZero() {
		buyerID = team.OwnerAdminID
	}
	buyer, err := s.loadUser(ctx, buyerID)
	if err != nil {
		buyer = models.User{ID: buyerID, Role: models.RoleTeamAdmin, TeamID: sub.TeamID}
	}
	sub.Status = "active"
	sub.ExternalTransactionID = transactionID
	sub.StartedAt = now
	sub.ExpiresAt = &expires
	actor := s.notificationActorName(ctx, buyerID)
	s.notifyOwnerAdmins(ctx, buyerID, "subscription_purchase", actor+" purchased the "+period+" "+plan.Name+" package with PayPal.", sub.ID)
	s.enqueuePurchaseAlertEmail(ctx, buyer, team, plan, sub, amount, teamSeatCount(team))
	s.audit(ctx, buyerID, "subscription.paid", "subscription", sub.ID)
	return invoice, nil
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
		event, err := provider.HandleWebhook(c.Request.Context(), body, map[string]string{"signature": c.GetHeader("Paypal-Transmission-Sig")})
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
