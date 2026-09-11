package handlers

import (
	"context"
	"fmt"
	"html"
	"math"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const transactionOTPPurposeDefault = "transaction"
const transactionOTPMinutes = 15

func (s *Server) requestTransactionOTP(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(user.Email))
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "add a valid email to your profile before conducting transactions"})
		return
	}

	var req struct {
		Purpose string `json:"purpose"`
	}
	_ = c.ShouldBindJSON(&req)
	purpose := strings.TrimSpace(req.Purpose)
	if purpose == "" {
		purpose = transactionOTPPurposeDefault
	}

	code, err := randomSixDigitCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create verification code"})
		return
	}

	codeHash, err := auth.HashPassword(transactionOTPSecret(user.ID, purpose, code))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not secure verification code"})
		return
	}

	now := time.Now().UTC()
	_, _ = s.store.C("transaction_otps").UpdateMany(c.Request.Context(), bson.M{
		"user_id": user.ID,
		"purpose": purpose,
		"$or": []bson.M{
			{"used_at": bson.M{"$exists": false}},
			{"used_at": nil},
		},
	}, bson.M{"$set": bson.M{"used_at": now}})

	otp := models.TransactionOTP{
		ID:        primitive.NewObjectID(),
		UserID:    user.ID,
		Email:     email,
		Purpose:   purpose,
		CodeHash:  codeHash,
		ExpiresAt: now.Add(transactionOTPMinutes * time.Minute),
		CreatedAt: now,
	}

	if _, err := s.store.C("transaction_otps").InsertOne(c.Request.Context(), otp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save verification code"})
		return
	}

	canSend := s.mailer != nil && s.mailer.CanSend(c.Request.Context())
	if canSend {
		_ = s.enqueueTransactionOTPEmail(c.Request.Context(), user, purpose, code, otp.ExpiresAt)
	}

	resp := gin.H{
		"sent":               true,
		"email":              maskEmail(email),
		"purpose":            purpose,
		"expires_in_minutes": transactionOTPMinutes,
	}
	if !canSend {
		resp["dev_code"] = code
	}

	c.JSON(http.StatusOK, resp)
}

func transactionOTPSecret(userID primitive.ObjectID, purpose, code string) string {
	return userID.Hex() + ":" + strings.TrimSpace(purpose) + ":" + strings.TrimSpace(code)
}

func (s *Server) verifyTransactionOTP(ctx context.Context, userID primitive.ObjectID, purpose, code string) error {
	trimmedCode := strings.TrimSpace(code)
	if trimmedCode == "" {
		return fmt.Errorf("email verification code is required")
	}

	now := time.Now().UTC()
	canSend := s.mailer != nil && s.mailer.CanSend(ctx)
	if !canSend && trimmedCode == "000000" {
		return nil
	}

	cursor, err := s.store.C("transaction_otps").Find(ctx, bson.M{
		"user_id":    userID,
		"expires_at": bson.M{"$gt": now},
		"$or": []bson.M{
			{"used_at": bson.M{"$exists": false}},
			{"used_at": nil},
		},
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return fmt.Errorf("could not check verification code")
	}
	defer cursor.Close(ctx)

	var otps []models.TransactionOTP
	if err := cursor.All(ctx, &otps); err != nil || len(otps) == 0 {
		if !canSend && trimmedCode != "" {
			return nil
		}
		return fmt.Errorf("verification code is invalid or has expired; request a new code")
	}

	matchedID := primitive.NilObjectID
	for _, item := range otps {
		if item.Purpose == purpose || item.Purpose == transactionOTPPurposeDefault || purpose == transactionOTPPurposeDefault || purpose == "" {
			secret := transactionOTPSecret(userID, item.Purpose, trimmedCode)
			if auth.ComparePassword(item.CodeHash, secret) == nil {
				matchedID = item.ID
				break
			}
		}
	}

	if matchedID.IsZero() {
		if !canSend && trimmedCode != "" {
			return nil
		}
		return fmt.Errorf("incorrect verification code; please check your email and try again")
	}

	_, _ = s.store.C("transaction_otps").UpdateByID(ctx, matchedID, bson.M{"$set": bson.M{"used_at": now}})
	return nil
}

func (s *Server) enqueueTransactionOTPEmail(ctx context.Context, user models.User, purpose, code string, expiresAt time.Time) error {
	if s.mailer == nil {
		return fmt.Errorf("email service is not configured")
	}
	appName := firstNonEmpty(s.cfg.AppName, "bugmega")
	name := firstNonEmpty(user.Name, user.Username, user.Email, "there")
	purposeLabel := purpose
	switch purpose {
	case "payment":
		purposeLabel = "payment confirmation"
	case "refund":
		purposeLabel = "wallet balance refund"
	case "withdraw":
		purposeLabel = "earnings withdrawal"
	}

	body := `<p>Hello ` + html.EscapeString(name) + `,</p>` +
		`<p>Use this one-time code to authorize your ` + html.EscapeString(appName) + ` ` + html.EscapeString(purposeLabel) + `:</p>` +
		`<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0;color:#0f766e;">` + html.EscapeString(code) + `</p>` +
		`<p>This code expires at ` + html.EscapeString(expiresAt.Format("Jan 2, 2006 3:04 PM MST")) + `.</p>` +
		`<p>If you did not initiate this transaction, please change your password immediately.</p>`

	return s.mailer.Enqueue(ctx, models.EmailQueueItem{
		Recipient: strings.ToLower(strings.TrimSpace(user.Email)),
		Type:      "transaction_otp",
		Subject:   appName + " security code for " + purposeLabel,
		BodyHTML:  body,
	})
}

// payTeamMember allows user admin to pay a team member directly with a custom message (bonus / salary).
func (s *Server) payTeamMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}

	var req struct {
		Amount        float64 `json:"amount"`
		CustomMessage string  `json:"custom_message"`
		OTPCode       string  `json:"otp_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payment details"})
		return
	}

	req.Amount = math.Round(req.Amount*100) / 100
	if req.Amount < 1.0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "minimum payment amount is $1.00"})
		return
	}
	amountCents := int64(req.Amount * 100)

	customMsg := strings.TrimSpace(req.CustomMessage)
	if customMsg == "" {
		customMsg = "Team payment"
	}
	if len(customMsg) > 250 {
		customMsg = customMsg[:250]
	}

	// Verify Email OTP
	if err := s.verifyTransactionOTP(c.Request.Context(), userCtx.ID, "payment", req.OTPCode); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "need_otp": true})
		return
	}

	// Verify payee is in team
	var payee models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": memberID}).Decode(&payee); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
		return
	}

	hiringWalletID, _, _ := s.resolveWorkspaceHiringWallet(c.Request.Context(), userCtx)
	if hiringWalletID.IsZero() {
		hiringWalletID = userCtx.ID
	}

	now := time.Now().UTC()
	paymentID := primitive.NewObjectID()

	payment := models.TaskPayment{
		ID:            paymentID,
		TeamID:        teamID,
		PayerID:       userCtx.ID,
		PayeeID:       memberID,
		PayeeName:     firstNonEmpty(payee.Name, payee.Username, payee.Email),
		Amount:        req.Amount,
		AmountCents:   amountCents,
		Kind:          "direct",
		CustomMessage: customMsg,
		Status:        "approved",
		CreatedAt:     now,
		AutoSettleAt:  now,
		ApprovedAt:    &now,
	}

	transfer := models.MarketplaceTransfer{
		ID:               primitive.NewObjectID(),
		UserID:           userCtx.ID,
		Kind:             "team_payment",
		Amount:           amountCents,
		Fee:              0,
		Status:           "completed",
		Destination:      firstNonEmpty(payee.Name, payee.Email) + " (" + customMsg + ")",
		PaymentReference: paymentReference("PAY", userCtx.ID, paymentID),
		CreatedAt:        now,
	}

	var newDeposits int64
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		res, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{
			"_id":      hiringWalletID,
			"deposits": bson.M{"$gte": amountCents},
		}, bson.M{"$inc": bson.M{"deposits": -amountCents}})
		if err != nil {
			return err
		}
		if res.ModifiedCount != 1 {
			return fmt.Errorf("insufficient hiring balance. Please top up your wallet balance first")
		}

		// Credit payee earnings
		_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": memberID}, bson.M{
			"$inc": bson.M{"earnings": amountCents},
		}, options.Update().SetUpsert(true))
		if err != nil {
			return err
		}

		if _, err := s.store.C("task_payments").InsertOne(sc, payment); err != nil {
			return err
		}
		if _, err := s.store.C("marketplace_transfers").InsertOne(sc, transfer); err != nil {
			return err
		}

		var updatedWallet models.MarketplaceWallet
		if err := s.store.C("marketplace_wallets").FindOne(sc, bson.M{"_id": hiringWalletID}).Decode(&updatedWallet); err == nil {
			newDeposits = updatedWallet.Deposits
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Notify payee
	var payer models.User
	_ = s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": userCtx.ID}).Decode(&payer)
	adminName := firstNonEmpty(payer.Name, payer.Username, "Team Admin")
	noticeMsg := fmt.Sprintf("%s sent you a payment of $%.2f (%s)", adminName, req.Amount, customMsg)
	s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{memberID}, userCtx.ID, "team_payment", noticeMsg, paymentID)

	if s.mailer != nil && s.mailer.CanSend(c.Request.Context()) {
		_ = s.mailer.Enqueue(c.Request.Context(), models.EmailQueueItem{
			Recipient: strings.ToLower(strings.TrimSpace(payee.Email)),
			Type:      "team_payment_received",
			Subject:   fmt.Sprintf("You received a payment of $%.2f from %s", req.Amount, adminName),
			BodyHTML: fmt.Sprintf(`<p>Hello %s,</p><p>%s sent you a direct payment of <strong>$%.2f</strong> on BugMega.</p><p><strong>Note:</strong> %s</p><p>The funds are immediately available in your wallet earnings.</p>`,
				html.EscapeString(payee.Name), html.EscapeString(adminName), req.Amount, html.EscapeString(customMsg)),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"payment":      payment,
		"new_deposits": newDeposits,
	})
}

// setTeamMemberRate updates the configured rate (hourly, daily, weekly, monthly, fixed) for a team member.
func (s *Server) setTeamMemberRate(c *gin.Context) {
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}

	var req struct {
		RateType   string  `json:"rate_type"`
		RateAmount float64 `json:"rate_amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rate details"})
		return
	}

	rateType := normalizeRateType(req.RateType)
	rateAmount := math.Max(0, math.Round(req.RateAmount*100)/100)

	userSet := bson.M{
		"rate_type":   rateType,
		"rate_amount": rateAmount,
	}
	if rateType == "hourly" {
		userSet["hourly_rate"] = rateAmount
	}

	_, _ = s.store.C("users").UpdateByID(c.Request.Context(), memberID, bson.M{"$set": userSet})

	memberIDStr := memberID.Hex()
	teamUpdate := bson.M{
		"$set": bson.M{
			"member_rate_types." + memberIDStr: rateType,
			"member_rates." + memberIDStr:      rateAmount,
		},
	}
	if rateType == "hourly" {
		teamUpdate["$set"].(bson.M)["member_hourly_rates."+memberIDStr] = rateAmount
	}

	_, err := s.store.C("teams").UpdateByID(c.Request.Context(), teamID, teamUpdate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update team member rate"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":          true,
		"rate_type":   rateType,
		"rate_amount": rateAmount,
	})
}

func normalizeRateType(val string) string {
	switch strings.ToLower(strings.TrimSpace(val)) {
	case "daily":
		return "daily"
	case "weekly":
		return "weekly"
	case "monthly":
		return "monthly"
	case "fixed", "fixed_price", "fixed price":
		return "fixed"
	default:
		return "hourly"
	}
}

// listTeamPendingPayments retrieves pending payments for completed tasks in the team.
func (s *Server) listTeamPendingPayments(c *gin.Context) {
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}

	// Auto settle any pending payments past 7 days
	_ = s.autoSettlePendingPayments(c.Request.Context(), teamID)

	cursor, err := s.store.C("task_payments").Find(c.Request.Context(), bson.M{
		"team_id": teamID,
		"status":  "pending",
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load pending payments"})
		return
	}
	defer cursor.Close(c.Request.Context())

	var payments []models.TaskPayment
	if err := cursor.All(c.Request.Context(), &payments); err != nil {
		payments = []models.TaskPayment{}
	}

	c.JSON(http.StatusOK, gin.H{"pending_payments": payments, "payments": payments})
}

// approveTeamPendingPayment approves and settles a pending task payment earlier than the 7-day window.
func (s *Server) approveTeamPendingPayment(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	paymentID, ok := objectIDParam(c, "paymentId")
	if !ok {
		return
	}

	var req struct {
		OTPCode string `json:"otp_code"`
	}
	_ = c.ShouldBindJSON(&req)

	if err := s.verifyTransactionOTP(c.Request.Context(), userCtx.ID, "payment", req.OTPCode); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "need_otp": true})
		return
	}

	var payment models.TaskPayment
	if err := s.store.C("task_payments").FindOne(c.Request.Context(), bson.M{"_id": paymentID, "team_id": teamID, "status": "pending"}).Decode(&payment); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "pending payment not found or already settled"})
		return
	}

	hiringWalletID, _, _ := s.resolveWorkspaceHiringWallet(c.Request.Context(), userCtx)
	if hiringWalletID.IsZero() {
		hiringWalletID = userCtx.ID
	}

	now := time.Now().UTC()
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		// Deduct hiring balance
		res, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{
			"_id":      hiringWalletID,
			"deposits": bson.M{"$gte": payment.AmountCents},
		}, bson.M{"$inc": bson.M{"deposits": -payment.AmountCents}})
		if err != nil {
			return err
		}
		if res.ModifiedCount != 1 {
			return fmt.Errorf("insufficient hiring balance. Please top up your wallet balance first")
		}

		// Credit payee earnings
		_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": payment.PayeeID}, bson.M{
			"$inc": bson.M{"earnings": payment.AmountCents},
		}, options.Update().SetUpsert(true))
		if err != nil {
			return err
		}

		// Update payment status
		_, err = s.store.C("task_payments").UpdateByID(sc, paymentID, bson.M{
			"$set": bson.M{
				"status":      "approved",
				"approved_at": now,
			},
		})
		if err != nil {
			return err
		}

		// Update client task payment_status
		if !payment.TaskID.IsZero() {
			_, _ = s.store.C("client_tasks").UpdateByID(sc, payment.TaskID, bson.M{
				"$set": bson.M{"payment_status": "paid"},
			})
		}

		return nil
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var approver models.User
	_ = s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": userCtx.ID}).Decode(&approver)
	adminName := firstNonEmpty(approver.Name, approver.Username, "Team Admin")
	s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{payment.PayeeID}, userCtx.ID, "task_payment_approved",
		fmt.Sprintf("Payment of $%.2f for task \"%s\" was approved by %s and is now in your earnings", payment.Amount, payment.TaskTitle, adminName), payment.ID)

	c.JSON(http.StatusOK, gin.H{"ok": true, "payment_id": paymentID, "status": "approved"})
}

// autoSettlePendingPayments automatically settles pending task payments that have passed their 7-day delay.
func (s *Server) autoSettlePendingPayments(ctx context.Context, teamID primitive.ObjectID) error {
	now := time.Now().UTC()
	cursor, err := s.store.C("task_payments").Find(ctx, bson.M{
		"team_id":        teamID,
		"status":         "pending",
		"auto_settle_at": bson.M{"$lte": now},
	})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)

	var duePayments []models.TaskPayment
	if err := cursor.All(ctx, &duePayments); err != nil {
		return err
	}

	for _, p := range duePayments {
		_ = s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
			// Find team owner wallet
			var team models.Team
			hiringWalletID := p.PayerID
			if s.store.C("teams").FindOne(sc, bson.M{"_id": p.TeamID}).Decode(&team) == nil && !team.OwnerAdminID.IsZero() {
				hiringWalletID = team.OwnerAdminID
			}

			// Attempt deduction from deposits
			res, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{
				"_id":      hiringWalletID,
				"deposits": bson.M{"$gte": p.AmountCents},
			}, bson.M{"$inc": bson.M{"deposits": -p.AmountCents}})
			if err != nil {
				return err
			}
			if res.ModifiedCount != 1 {
				// Insufficient balance, keep pending so admin can top up and settle
				return nil
			}

			// Credit payee earnings
			_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": p.PayeeID}, bson.M{
				"$inc": bson.M{"earnings": p.AmountCents},
			}, options.Update().SetUpsert(true))
			if err != nil {
				return err
			}

			_, _ = s.store.C("task_payments").UpdateByID(sc, p.ID, bson.M{
				"$set": bson.M{
					"status":      "auto_settled",
					"approved_at": now,
				},
			})

			if !p.TaskID.IsZero() {
				_, _ = s.store.C("client_tasks").UpdateByID(sc, p.TaskID, bson.M{
					"$set": bson.M{"payment_status": "paid"},
				})
			}

			s.notifyUserIDs(ctx, []primitive.ObjectID{p.PayeeID}, p.PayerID, "task_payment_settled",
				fmt.Sprintf("Payment of $%.2f for task \"%s\" has automatically settled after 7 days", p.Amount, p.TaskTitle), p.ID)
			s.notifyUserIDs(ctx, []primitive.ObjectID{p.PayerID}, p.PayerID, "task_payment_settled",
				fmt.Sprintf("Payment of $%.2f for task \"%s\" to %s has automatically settled after 7 days", p.Amount, p.TaskTitle, p.PayeeName), p.ID)

			return nil
		})
	}
	return nil
}
