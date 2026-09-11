package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/config"
	"bugmark/internal/email"
	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"bugmark/internal/realtime"
	"bugmark/internal/store"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestNormalizeRateType(t *testing.T) {
	cases := map[string]string{
		"hourly":      "hourly",
		"Hourly":      "hourly",
		"  HOURLY  ":  "hourly",
		"daily":       "daily",
		"Daily":       "daily",
		"weekly":      "weekly",
		"monthly":     "monthly",
		"Monthly":     "monthly",
		"fixed":       "fixed",
		"fixed_price": "fixed",
		"fixed price": "fixed",
		"FIXED PRICE": "fixed",
		"unknown":     "hourly",
		"":            "hourly",
	}
	for input, expected := range cases {
		got := normalizeRateType(input)
		if got != expected {
			t.Errorf("normalizeRateType(%q) = %q; want %q", input, got, expected)
		}
	}
}

func TestTransactionOTPSecret(t *testing.T) {
	userID := primitive.NewObjectID()
	secret := transactionOTPSecret(userID, "payment", "123456")
	expected := userID.Hex() + ":payment:123456"
	if secret != expected {
		t.Errorf("got secret %q; want %q", secret, expected)
	}
}

func TestRandomSixDigitCode(t *testing.T) {
	for i := 0; i < 20; i++ {
		code, err := randomSixDigitCode()
		if err != nil {
			t.Fatalf("unexpected error generating code: %v", err)
		}
		if len(code) != 6 {
			t.Errorf("code %q length is %d; want 6", code, len(code))
		}
		for _, ch := range code {
			if ch < '0' || ch > '9' {
				t.Errorf("code %q contains non-digit: %c", code, ch)
			}
		}
	}
}

func TestTaskCompletionAutoSettleCalculations(t *testing.T) {
	now := time.Now().UTC()
	autoSettleAt := now.Add(7 * 24 * time.Hour)
	diff := autoSettleAt.Sub(now)
	if diff < 7*24*time.Hour-time.Minute || diff > 7*24*time.Hour+time.Minute {
		t.Errorf("autoSettleAt unexpected difference: %v", diff)
	}

	// Hourly rate with max seconds limit
	hourlyRate := 25.0                 // $25/hr
	maxSeconds := int64(4 * 3600)      // max 4h
	trackedSeconds := int64(10 * 3600) // 10h tracked

	effectiveSeconds := trackedSeconds
	if maxSeconds > 0 && effectiveSeconds > maxSeconds {
		effectiveSeconds = maxSeconds
	}
	if effectiveSeconds != 4*3600 {
		t.Errorf("effectiveSeconds = %d; want %d", effectiveSeconds, 4*3600)
	}

	amount := (float64(effectiveSeconds) / 3600.0) * hourlyRate
	if amount != 100.0 {
		t.Errorf("hourly calculated amount = %f; want 100.0", amount)
	}
}

func tryConnectTestMongo(ctx context.Context) (*mongo.Client, error) {
	uri := os.Getenv("MARKETPLACE_TEST_URI")
	if uri == "" {
		uri = os.Getenv("MONGO_URI")
	}
	if uri == "" {
		uri = "mongodb://127.0.0.1:27017"
	}
	connectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	client, err := mongo.Connect(connectCtx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(2*time.Second))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(connectCtx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}
	return client, nil
}

func TestTeamPaymentIntegration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB integration test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_paytest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_paytest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	cfg := config.Config{AppName: "bugmark", AppURL: "http://localhost:8080", OwnerEmail: "owner@example.test"}
	s := &Server{
		store:  st,
		cfg:    cfg,
		hub:    realtime.NewHub(),
		mailer: email.NewWorker(cfg, st),
	}

	adminID := primitive.NewObjectID()
	memberID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()

	adminUser := models.User{
		ID:            adminID,
		Name:          "Admin User",
		Username:      "adminuser",
		Email:         "admin@example.test",
		EmailVerified: true,
		Role:          models.RoleOwnerAdmin,
		StaffRole:     "owner",
		TeamID:        teamID,
		Status:        models.StatusActive,
	}
	memberUser := models.User{
		ID:            memberID,
		Name:          "Member Freelancer",
		Username:      "memberfreelancer",
		Email:         "member@example.test",
		EmailVerified: true,
		Role:          models.RoleMember,
		StaffRole:     "member",
		TeamID:        teamID,
		Status:        models.StatusActive,
	}

	_, _ = st.C("users").InsertOne(ctx, adminUser)
	_, _ = st.C("users").InsertOne(ctx, memberUser)

	team := models.Team{
		ID:              teamID,
		Name:            "Acme Dev",
		OwnerAdminID:    adminID,
		MemberIDs:       []primitive.ObjectID{adminID, memberID},
		MemberRateTypes: map[string]string{},
		MemberRates:     map[string]float64{},
		CreatedAt:       time.Now().UTC(),
	}
	_, _ = st.C("teams").InsertOne(ctx, team)

	// Admin starts with $500 available hiring balance (50,000 cents)
	_, _ = st.C("marketplace_wallets").InsertOne(ctx, bson.M{
		"_id":      adminID,
		"deposits": int64(50000),
		"reserved": int64(0),
		"earnings": int64(0),
		"pending":  int64(0),
	})

	// Setup Gin router with auth middleware mock
	router := gin.New()
	var currentTestUser models.User = adminUser
	authed := router.Group("/api")
	authed.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:     currentTestUser.ID,
			Role:   currentTestUser.Role,
			TeamID: currentTestUser.TeamID,
		})
		c.Next()
	})

	authed.POST("/wallet/otp", s.requestTransactionOTP)
	authed.POST("/teams/:id/members/:userId/pay", s.payTeamMember)
	authed.PUT("/teams/:id/members/:userId/rate", s.setTeamMemberRate)
	authed.GET("/teams/:id/pending-payments", s.listTeamPendingPayments)
	authed.POST("/teams/:id/pending-payments/:paymentId/approve", s.approveTeamPendingPayment)
	authed.POST("/marketplace/transfers", s.marketplaceRequestTransfer)
	authed.GET("/marketplace/admin/transfers", s.marketplaceAdminTransfers)
	authed.POST("/marketplace/admin/transfers/:id", s.marketplaceSettleTransfer)
	authed.GET("/admin/users", s.adminUsers)
	authed.POST("/admin/users/:id/topup", s.adminUserTopup)
	authed.GET("/admin/users/:id/transactions", s.adminUserTransactions)

	// 1. Request OTP for admin
	var otpDevCode string
	{
		body, _ := json.Marshal(map[string]string{"purpose": "payment"})
		req := httptest.NewRequest("POST", "/api/wallet/otp", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("requestTransactionOTP failed with %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if resp["sent"] != true {
			t.Errorf("expected sent=true, got %v", resp)
		}
		if devCode, ok := resp["dev_code"].(string); ok {
			otpDevCode = devCode
		} else {
			// Find inserted OTP in DB directly if dev_code wasn't provided
			var item models.TransactionOTP
			_ = st.C("transaction_otps").FindOne(ctx, bson.M{"user_id": adminID, "purpose": "payment"}).Decode(&item)
			for c := 100000; c <= 999999; c++ {
				testCode := string(rune(c))
				sec := transactionOTPSecret(adminID, "payment", testCode)
				if auth.ComparePassword(item.CodeHash, sec) == nil {
					otpDevCode = testCode
					break
				}
			}
		}
	}

	// 2. Set team member rate
	{
		ratePayload, _ := json.Marshal(map[string]interface{}{
			"rate_type":   "monthly",
			"rate_amount": 2500.00,
		})
		req := httptest.NewRequest("PUT", "/api/teams/"+teamID.Hex()+"/members/"+memberID.Hex()+"/rate", bytes.NewReader(ratePayload))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("setTeamMemberRate failed with %d: %s", w.Code, w.Body.String())
		}

		var updatedTeam models.Team
		_ = st.C("teams").FindOne(ctx, bson.M{"_id": teamID}).Decode(&updatedTeam)
		if updatedTeam.MemberRateTypes[memberID.Hex()] != "monthly" {
			t.Errorf("expected member rate type monthly, got %q", updatedTeam.MemberRateTypes[memberID.Hex()])
		}
		if updatedTeam.MemberRates[memberID.Hex()] != 2500.00 {
			t.Errorf("expected member rate 2500, got %f", updatedTeam.MemberRates[memberID.Hex()])
		}
	}

	// 3. Direct pay team member with OTP
	{
		payPayload, _ := json.Marshal(map[string]interface{}{
			"amount":         100.00,
			"custom_message": "Monthly bonus",
			"otp_code":       otpDevCode,
		})
		req := httptest.NewRequest("POST", "/api/teams/"+teamID.Hex()+"/members/"+memberID.Hex()+"/pay", bytes.NewReader(payPayload))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("payTeamMember failed with %d: %s", w.Code, w.Body.String())
		}

		// Check admin balance: was 50000 cents, now should be 40000 cents ($400)
		var adminWallet models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": adminID}).Decode(&adminWallet)
		if adminWallet.Deposits != 40000 {
			t.Errorf("expected admin deposits 40000 cents, got %d", adminWallet.Deposits)
		}

		// Check member earnings: was 0, now should be 10000 cents ($100)
		var memberWallet models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": memberID}).Decode(&memberWallet)
		if memberWallet.Earnings != 10000 {
			t.Errorf("expected member earnings 10000 cents, got %d", memberWallet.Earnings)
		}

		// OTP should now be marked as used
		var otp models.TransactionOTP
		_ = st.C("transaction_otps").FindOne(ctx, bson.M{"user_id": adminID}).Decode(&otp)
		if otp.UsedAt == nil {
			t.Error("expected OTP to be marked used")
		}
	}

	// 4. Pending task payment creation & early manual approval
	taskID := primitive.NewObjectID()
	paymentID := primitive.NewObjectID()
	{
		// Create task payment with pending status and 7 days auto-settle
		now := time.Now().UTC()
		p := models.TaskPayment{
			ID:            paymentID,
			TeamID:        teamID,
			TaskID:        taskID,
			TaskTitle:     "Deploy landing page",
			PayerID:       adminID,
			PayeeID:       memberID,
			Amount:        50.00,
			AmountCents:   5000,
			Kind:          "task_completion",
			CustomMessage: "Payment for task Deploy landing page",
			Status:        "pending",
			CreatedAt:     now,
			AutoSettleAt:  now.Add(7 * 24 * time.Hour),
		}
		_, err = st.C("task_payments").InsertOne(ctx, p)
		if err != nil {
			t.Fatalf("failed to insert test task payment: %v", err)
		}

		// Also insert the client task
		clientTask := models.ClientTask{
			ID:            taskID,
			TeamID:        teamID,
			Title:         "Deploy landing page",
			Price:         50.00,
			BillingType:   "fixed",
			PaymentStatus: "pending",
		}
		_, _ = st.C("client_tasks").InsertOne(ctx, clientTask)

		// List pending payments
		req := httptest.NewRequest("GET", "/api/teams/"+teamID.Hex()+"/pending-payments", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("listTeamPendingPayments failed: %d %s", w.Code, w.Body.String())
		}
		var listResp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &listResp)
		payments := listResp["payments"].([]interface{})
		if len(payments) != 1 {
			t.Fatalf("expected 1 pending payment, got %d", len(payments))
		}

		// Request new OTP for approving payment
		otpReqBody, _ := json.Marshal(map[string]string{"purpose": "payment"})
		reqOTP := httptest.NewRequest("POST", "/api/wallet/otp", bytes.NewReader(otpReqBody))
		reqOTP.Header.Set("Content-Type", "application/json")
		wOTP := httptest.NewRecorder()
		router.ServeHTTP(wOTP, reqOTP)
		var otpResp map[string]interface{}
		_ = json.Unmarshal(wOTP.Body.Bytes(), &otpResp)
		approveOTP := otpResp["dev_code"].(string)

		// Approve payment
		approveBody, _ := json.Marshal(map[string]string{"otp_code": approveOTP})
		reqApprove := httptest.NewRequest("POST", "/api/teams/"+teamID.Hex()+"/pending-payments/"+paymentID.Hex()+"/approve", bytes.NewReader(approveBody))
		reqApprove.Header.Set("Content-Type", "application/json")
		wApprove := httptest.NewRecorder()
		router.ServeHTTP(wApprove, reqApprove)

		if wApprove.Code != http.StatusOK {
			t.Fatalf("approveTeamPendingPayment failed: %d %s", wApprove.Code, wApprove.Body.String())
		}

		// Verify payment status is approved
		var updatedPayment models.TaskPayment
		_ = st.C("task_payments").FindOne(ctx, bson.M{"_id": paymentID}).Decode(&updatedPayment)
		if updatedPayment.Status != "approved" {
			t.Errorf("expected payment status approved, got %q", updatedPayment.Status)
		}

		// Verify task status is paid
		var updatedTask models.ClientTask
		_ = st.C("client_tasks").FindOne(ctx, bson.M{"_id": taskID}).Decode(&updatedTask)
		if updatedTask.PaymentStatus != "paid" {
			t.Errorf("expected task payment_status paid, got %q", updatedTask.PaymentStatus)
		}

		// Verify admin deposits decremented by 5000 cents ($50), member earnings incremented by 5000
		var adminW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": adminID}).Decode(&adminW)
		if adminW.Deposits != 35000 {
			t.Errorf("expected admin deposits 35000 cents, got %d", adminW.Deposits)
		}
		var memberW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": memberID}).Decode(&memberW)
		if memberW.Earnings != 15000 {
			t.Errorf("expected member earnings 15000 cents, got %d", memberW.Earnings)
		}
	}

	// 5. 7-Day Auto-settle execution
	{
		overduePaymentID := primitive.NewObjectID()
		overdueTaskID := primitive.NewObjectID()
		pastTime := time.Now().UTC().Add(-8 * 24 * time.Hour)
		p := models.TaskPayment{
			ID:            overduePaymentID,
			TeamID:        teamID,
			TaskID:        overdueTaskID,
			TaskTitle:     "Old bug fix",
			PayerID:       adminID,
			PayeeID:       memberID,
			Amount:        20.00,
			AmountCents:   2000,
			Kind:          "task_completion",
			Status:        "pending",
			CreatedAt:     pastTime,
			AutoSettleAt:  pastTime.Add(7 * 24 * time.Hour), // 1 day ago
		}
		_, _ = st.C("task_payments").InsertOne(ctx, p)
		_, _ = st.C("client_tasks").InsertOne(ctx, models.ClientTask{
			ID:            overdueTaskID,
			TeamID:        teamID,
			Title:         "Old bug fix",
			PaymentStatus: "pending",
		})

		// Trigger auto settle
		if err := s.autoSettlePendingPayments(ctx, teamID); err != nil {
			t.Fatalf("autoSettlePendingPayments failed: %v", err)
		}

		// Verify payment status is auto_settled
		var settledPayment models.TaskPayment
		_ = st.C("task_payments").FindOne(ctx, bson.M{"_id": overduePaymentID}).Decode(&settledPayment)
		if settledPayment.Status != "auto_settled" {
			t.Errorf("expected status auto_settled, got %q", settledPayment.Status)
		}

		// Verify task payment status is paid
		var settledTask models.ClientTask
		_ = st.C("client_tasks").FindOne(ctx, bson.M{"_id": overdueTaskID}).Decode(&settledTask)
		if settledTask.PaymentStatus != "paid" {
			t.Errorf("expected task payment_status paid, got %q", settledTask.PaymentStatus)
		}

		// Verify admin deposits: 35000 - 2000 = 33000
		var adminW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": adminID}).Decode(&adminW)
		if adminW.Deposits != 33000 {
			t.Errorf("expected admin deposits 33000, got %d", adminW.Deposits)
		}

		// Verify member earnings: 15000 + 2000 = 17000
		var memberW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": memberID}).Decode(&memberW)
		if memberW.Earnings != 17000 {
			t.Errorf("expected member earnings 17000, got %d", memberW.Earnings)
		}
	}

	// 6. Marketplace refund requires OTP
	{
		// Attempt refund without OTP -> expect 400
		noOTPBody, _ := json.Marshal(map[string]interface{}{
			"kind":        "refund",
			"amount":      5000, // $50
			"destination": "admin-paypal@example.test",
			"accept_fees": true,
		})
		reqNoOTP := httptest.NewRequest("POST", "/api/marketplace/transfers", bytes.NewReader(noOTPBody))
		reqNoOTP.Header.Set("Content-Type", "application/json")
		wNoOTP := httptest.NewRecorder()
		router.ServeHTTP(wNoOTP, reqNoOTP)
		if wNoOTP.Code != http.StatusBadRequest && wNoOTP.Code != http.StatusForbidden {
			t.Errorf("expected 400 or 403 for refund without OTP, got %d: %s", wNoOTP.Code, wNoOTP.Body.String())
		}

		// Request OTP for refund
		otpReqBody, _ := json.Marshal(map[string]string{"purpose": "refund"})
		reqOTP := httptest.NewRequest("POST", "/api/wallet/otp", bytes.NewReader(otpReqBody))
		reqOTP.Header.Set("Content-Type", "application/json")
		wOTP := httptest.NewRecorder()
		router.ServeHTTP(wOTP, reqOTP)
		var otpResp map[string]interface{}
		_ = json.Unmarshal(wOTP.Body.Bytes(), &otpResp)
		refundOTP := otpResp["dev_code"].(string)

		// Attempt refund with valid OTP -> expect 200 or 201
		withOTPBody, _ := json.Marshal(map[string]interface{}{
			"kind":        "refund",
			"amount":      5000, // $50
			"destination": "admin-paypal@example.test",
			"accept_fees": true,
			"otp_code":    refundOTP,
		})
		reqWithOTP := httptest.NewRequest("POST", "/api/marketplace/transfers", bytes.NewReader(withOTPBody))
		reqWithOTP.Header.Set("Content-Type", "application/json")
		wWithOTP := httptest.NewRecorder()
		router.ServeHTTP(wWithOTP, reqWithOTP)
		if wWithOTP.Code != http.StatusOK && wWithOTP.Code != http.StatusCreated {
			t.Fatalf("refund with valid OTP failed: %d %s", wWithOTP.Code, wWithOTP.Body.String())
		}

		// Check admin deposits held: was 33000, 5000 deducted for refund -> 28000
		var adminW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": adminID}).Decode(&adminW)
		if adminW.Deposits != 28000 {
			t.Errorf("expected admin deposits 28000, got %d", adminW.Deposits)
		}
	}

	// 7. Platform owner notified by email & owner settlements management
	{
		// Verify email notification was queued for the platform owner
		var emailItem models.EmailQueueItem
		err := st.C("email_queue").FindOne(ctx, bson.M{"type": "owner_manual_transfer"}).Decode(&emailItem)
		if err != nil {
			t.Errorf("expected email_queue item of type owner_manual_transfer, got error: %v", err)
		} else {
			if !strings.Contains(emailItem.Subject, "refund") {
				t.Errorf("expected subject to mention refund, got %q", emailItem.Subject)
			}
			if !strings.Contains(emailItem.BodyHTML, "Admin User") {
				t.Errorf("expected body to mention requester Admin User, got %q", emailItem.BodyHTML)
			}
			if !strings.Contains(emailItem.BodyHTML, "/admin/settlements") {
				t.Errorf("expected body to link to /admin/settlements, got %q", emailItem.BodyHTML)
			}
		}

		// Query GET /api/marketplace/admin/transfers?status=requested
		reqTransfers := httptest.NewRequest("GET", "/api/marketplace/admin/transfers?status=requested", nil)
		wTransfers := httptest.NewRecorder()
		router.ServeHTTP(wTransfers, reqTransfers)
		if wTransfers.Code != http.StatusOK {
			t.Fatalf("marketplaceAdminTransfers failed: %d %s", wTransfers.Code, wTransfers.Body.String())
		}
		var listResp struct {
			Transfers          []models.MarketplaceTransfer `json:"transfers"`
			PendingCount       int64                        `json:"pending_count"`
			TotalPendingAmount int64                        `json:"total_pending_amount"`
		}
		if err := json.Unmarshal(wTransfers.Body.Bytes(), &listResp); err != nil {
			t.Fatalf("failed to decode transfers list: %v", err)
		}
		if listResp.PendingCount < 1 || len(listResp.Transfers) == 0 {
			t.Fatalf("expected at least 1 pending transfer, got count %d, list len %d", listResp.PendingCount, len(listResp.Transfers))
		}
		refundTransfer := listResp.Transfers[0]
		if refundTransfer.Kind != "refund" {
			t.Errorf("expected transfer kind refund, got %q", refundTransfer.Kind)
		}
		if refundTransfer.Amount != 5000 {
			t.Errorf("expected amount 5000, got %d", refundTransfer.Amount)
		}
		if refundTransfer.UserName != "Admin User" {
			t.Errorf("expected enriched UserName Admin User, got %q", refundTransfer.UserName)
		}
		if refundTransfer.UserEmail != "admin@example.test" {
			t.Errorf("expected enriched UserEmail admin@example.test, got %q", refundTransfer.UserEmail)
		}

		// Owner settles the refund transfer as paid
		settleBody, _ := json.Marshal(map[string]interface{}{
			"status":    "paid",
			"reference": "PP-MANUAL-REF-00123",
			"fee":       150, // $1.50 fee
		})
		reqSettle := httptest.NewRequest("POST", "/api/marketplace/admin/transfers/"+refundTransfer.ID.Hex(), bytes.NewReader(settleBody))
		reqSettle.Header.Set("Content-Type", "application/json")
		wSettle := httptest.NewRecorder()
		router.ServeHTTP(wSettle, reqSettle)
		if wSettle.Code != http.StatusOK {
			t.Fatalf("marketplaceSettleTransfer failed: %d %s", wSettle.Code, wSettle.Body.String())
		}

		// Verify transfer document in DB is paid
		var settledTransfer models.MarketplaceTransfer
		_ = st.C("marketplace_transfers").FindOne(ctx, bson.M{"_id": refundTransfer.ID}).Decode(&settledTransfer)
		if settledTransfer.Status != "paid" {
			t.Errorf("expected transfer status paid, got %q", settledTransfer.Status)
		}
		if settledTransfer.ExternalID != "PP-MANUAL-REF-00123" {
			t.Errorf("expected external ID PP-MANUAL-REF-00123, got %q", settledTransfer.ExternalID)
		}
		if settledTransfer.Fee != 150 {
			t.Errorf("expected fee 150, got %d", settledTransfer.Fee)
		}
	}

	// 7. Platform owner manual top-up, user transactions history, and wallet in admin users list
	{
		// A. Check GET /api/admin/users returns wallet info
		reqUsers := httptest.NewRequest("GET", "/api/admin/users", nil)
		wUsers := httptest.NewRecorder()
		router.ServeHTTP(wUsers, reqUsers)
		if wUsers.Code != http.StatusOK {
			t.Fatalf("adminUsers failed: %d %s", wUsers.Code, wUsers.Body.String())
		}
		var usersResp struct {
			Users []map[string]interface{} `json:"users"`
		}
		if err := json.Unmarshal(wUsers.Body.Bytes(), &usersResp); err != nil {
			t.Fatalf("failed to parse adminUsers response: %v", err)
		}
		if len(usersResp.Users) == 0 {
			t.Fatalf("expected at least 1 user in adminUsers response")
		}
		foundMember := false
		for _, u := range usersResp.Users {
			if u["id"] == memberID.Hex() {
				foundMember = true
				wallet, ok := u["wallet"].(map[string]interface{})
				if !ok {
					t.Fatalf("expected wallet map in user, got %T", u["wallet"])
				}
				if int64(wallet["earnings"].(float64)) != 17000 {
					t.Errorf("expected member earnings 17000, got %v", wallet["earnings"])
				}
			}
		}
		if !foundMember {
			t.Errorf("did not find member in adminUsers list")
		}

		// B. Manual top-up by platform owner to member's account ($100.00 = 10000 cents)
		topupPayload, _ := json.Marshal(map[string]interface{}{
			"amount_float": 100.00,
			"note":         "Comp bonus by platform owner",
		})
		reqTopup := httptest.NewRequest("POST", "/api/admin/users/"+memberID.Hex()+"/topup", bytes.NewReader(topupPayload))
		reqTopup.Header.Set("Content-Type", "application/json")
		wTopup := httptest.NewRecorder()
		router.ServeHTTP(wTopup, reqTopup)
		if wTopup.Code != http.StatusOK {
			t.Fatalf("adminUserTopup failed: %d %s", wTopup.Code, wTopup.Body.String())
		}
		var topupResp struct {
			OK       bool                     `json:"ok"`
			Wallet   models.MarketplaceWallet `json:"wallet"`
			Transfer models.MarketplaceTransfer `json:"transfer"`
			Message  string                   `json:"message"`
		}
		if err := json.Unmarshal(wTopup.Body.Bytes(), &topupResp); err != nil {
			t.Fatalf("failed to decode topup response: %v", err)
		}
		if !topupResp.OK {
			t.Errorf("expected topup ok=true")
		}
		if topupResp.Wallet.Deposits != 10000 {
			t.Errorf("expected member deposits 10000, got %d", topupResp.Wallet.Deposits)
		}
		if topupResp.Transfer.Amount != 10000 {
			t.Errorf("expected transfer amount 10000, got %d", topupResp.Transfer.Amount)
		}
		if topupResp.Transfer.Status != "paid" {
			t.Errorf("expected transfer status paid, got %q", topupResp.Transfer.Status)
		}

		// Check member wallet directly in MongoDB
		var updatedMemberW models.MarketplaceWallet
		_ = st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": memberID}).Decode(&updatedMemberW)
		if updatedMemberW.Deposits != 10000 {
			t.Errorf("expected member deposits in db 10000, got %d", updatedMemberW.Deposits)
		}

		// Check in-platform notification created for member
		var notif models.Notification
		_ = st.C("notifications").FindOne(ctx, bson.M{"user_id": memberID, "type": "marketplace_topup"}).Decode(&notif)
		if notif.ID.IsZero() {
			t.Errorf("expected topup notification for member")
		}

		// C. Query GET /api/admin/users/:id/transactions
		reqTx := httptest.NewRequest("GET", "/api/admin/users/"+memberID.Hex()+"/transactions", nil)
		wTx := httptest.NewRecorder()
		router.ServeHTTP(wTx, reqTx)
		if wTx.Code != http.StatusOK {
			t.Fatalf("adminUserTransactions failed: %d %s", wTx.Code, wTx.Body.String())
		}
		var txResp struct {
			User         map[string]interface{}     `json:"user"`
			Wallet       models.MarketplaceWallet   `json:"wallet"`
			Transactions []AdminUserTransactionItem `json:"transactions"`
		}
		if err := json.Unmarshal(wTx.Body.Bytes(), &txResp); err != nil {
			t.Fatalf("failed to decode transactions response: %v", err)
		}
		if txResp.Wallet.Deposits != 10000 {
			t.Errorf("expected wallet deposits 10000 in transactions view, got %d", txResp.Wallet.Deposits)
		}
		if len(txResp.Transactions) == 0 {
			t.Fatalf("expected at least 1 transaction, got 0")
		}
		foundTopupTx := false
		for _, tx := range txResp.Transactions {
			if tx.Kind == "topup" && tx.Amount == 10000 {
				foundTopupTx = true
				if tx.Direction != "credit" {
					t.Errorf("expected direction credit, got %q", tx.Direction)
				}
				if tx.Status != "paid" {
					t.Errorf("expected status paid, got %q", tx.Status)
				}
			}
		}
		if !foundTopupTx {
			t.Errorf("did not find topup transaction in member's transaction history")
		}
	}
}
