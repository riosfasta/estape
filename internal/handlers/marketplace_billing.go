package handlers

import (
	"context"
	"strings"
	"time"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) marketplaceReleaseEarnings(ctx context.Context, id primitive.ObjectID) error {
	return s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		cur, err := s.store.C("marketplace_earnings").Find(sc, bson.M{"user_id": id, "status": "pending", "available_at": bson.M{"$lte": time.Now().UTC()}})
		if err != nil {
			return err
		}
		defer cur.Close(sc)
		var records []struct {
			ID     primitive.ObjectID `bson:"_id"`
			Amount int64              `bson:"amount"`
		}
		if err = cur.All(sc, &records); err != nil {
			return err
		}
		for _, record := range records {
			_, err = s.store.C("marketplace_earnings").UpdateOne(sc, bson.M{"_id": record.ID}, bson.M{"$set": bson.M{"status": "available"}})
			if err != nil {
				return err
			}
			_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$inc": bson.M{"pending": -record.Amount, "earnings": record.Amount}})
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) marketplaceWallet(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	if marketplaceError(c, s.marketplaceReleaseEarnings(ctx, user.ID)) {
		return
	}
	var wallet models.MarketplaceWallet
	err := s.store.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": user.ID}).Decode(&wallet)
	if err == mongo.ErrNoDocuments {
		wallet.ID = user.ID
	} else if marketplaceError(c, err) {
		return
	}
	cur, err := s.store.C("marketplace_transfers").Find(ctx, bson.M{"user_id": user.ID}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	records := []models.MarketplaceTransfer{}
	if marketplaceError(c, cur.All(ctx, &records)) {
		return
	}
	pending, err := s.store.C("marketplace_earnings").Find(ctx, bson.M{"user_id": user.ID}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "available_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer pending.Close(ctx)
	earnings := []bson.M{}
	if marketplaceError(c, pending.All(ctx, &earnings)) {
		return
	}
	c.JSON(200, gin.H{"wallet": wallet, "transfers": records, "earnings": earnings, "currency": "USD"})
}

func (s *Server) marketplaceTopup(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var req struct {
		Amount int64 `json:"amount"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Amount < 100 || req.Amount > maximumMarketplaceAmount {
		marketplaceError(c, marketInvalid("Top up between $1 and $100,000"))
		return
	}
	base, err := s.payPalCheckoutBase(ctx)
	if err != nil {
		marketplaceError(c, marketInvalid("PayPal checkout is not configured. Contact the platform owner"))
		return
	}
	provider := s.payments["paypal"]
	if provider == nil {
		marketplaceError(c, marketInvalid("PayPal is unavailable"))
		return
	}
	transfer := models.MarketplaceTransfer{ID: primitive.NewObjectID(), UserID: user.ID, Kind: "topup", Amount: req.Amount, Status: "creating", CreatedAt: time.Now().UTC()}
	if _, err = s.store.C("marketplace_transfers").InsertOne(ctx, transfer); marketplaceError(c, err) {
		return
	}
	base.Amount = req.Amount
	base.Currency = "USD"
	base.CustomID = "wallet-" + transfer.ID.Hex()
	base.InvoiceID = base.CustomID
	base.Description = "Refundable hiring balance (transaction costs may apply to refunds)"
	base.ReturnURL = s.appAbsoluteURL("/wallet?topup=" + transfer.ID.Hex())
	base.CancelURL = s.appAbsoluteURL("/wallet?cancelled=1")
	checkout, err := provider.CreateCheckout(ctx, base)
	if err != nil {
		marketplaceError(c, marketInvalid("Unable to create checkout. No wallet balance has been credited"))
		return
	}
	_, err = s.store.C("marketplace_transfers").UpdateOne(ctx, bson.M{"_id": transfer.ID}, bson.M{"$set": bson.M{"status": "pending", "external_id": checkout.ExternalID}})
	if !marketplaceError(c, err) {
		c.JSON(201, gin.H{"url": checkout.URL})
	}
}

func (s *Server) marketplaceCaptureTopup(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var transfer models.MarketplaceTransfer
	if marketplaceError(c, s.store.C("marketplace_transfers").FindOne(ctx, bson.M{"_id": id, "user_id": user.ID, "kind": "topup"}).Decode(&transfer)) {
		return
	}
	if transfer.Status == "completed" {
		c.JSON(200, gin.H{"ok": true})
		return
	}
	if transfer.Status != "pending" {
		marketplaceError(c, marketInvalid("Checkout is not ready"))
		return
	}
	base, err := s.payPalCheckoutBase(ctx)
	if err != nil {
		marketplaceError(c, marketInvalid("PayPal is unavailable"))
		return
	}
	provider := s.payments["paypal"]
	if provider == nil {
		marketplaceError(c, marketInvalid("PayPal is unavailable"))
		return
	}
	capture, err := provider.CaptureCheckout(ctx, base, transfer.ExternalID)
	if err != nil {
		marketplaceError(c, marketInvalid("Payment capture is not confirmed. Retry this payment from your wallet"))
		return
	}
	if capture.Status != "COMPLETED" || capture.Amount != transfer.Amount || capture.Currency != "USD" || capture.ExternalID != transfer.ExternalID || capture.CaptureID == "" {
		marketplaceError(c, marketInvalid("Payment could not be verified; no balance has been credited"))
		return
	}
	err = s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		result, err := s.store.C("marketplace_transfers").UpdateOne(sc, bson.M{"_id": id, "status": "pending"}, bson.M{"$set": bson.M{"status": "completed", "capture_id": capture.CaptureID}})
		if err != nil {
			return err
		}
		if result.ModifiedCount == 0 {
			return nil
		}
		_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": user.ID}, bson.M{"$inc": bson.M{"deposits": transfer.Amount}}, options.Update().SetUpsert(true))
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

// Outbound payments are explicitly queued for owner settlement. The existing
// provider only supports checkout/capture, not payouts. Never report a queued
// request as paid or call the provider's no-op RefundPayment implementation.
func (s *Server) marketplaceRequestTransfer(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var req struct {
		Kind        string `json:"kind"`
		Amount      int64  `json:"amount"`
		Destination string `json:"destination"`
		AcceptFees  bool   `json:"accept_fees"`
	}
	if c.ShouldBindJSON(&req) != nil || (req.Kind != "refund" && req.Kind != "withdrawal") || req.Amount < 100 || req.Amount > maximumMarketplaceAmount || len(strings.TrimSpace(req.Destination)) < 5 || len(req.Destination) > 250 || !req.AcceptFees {
		marketplaceError(c, marketInvalid("Choose refund or withdrawal, an amount, payout details and acknowledge transaction fees"))
		return
	}
	if marketplaceError(c, s.marketplaceReleaseEarnings(ctx, user.ID)) {
		return
	}
	transfer := models.MarketplaceTransfer{ID: primitive.NewObjectID(), UserID: user.ID, Kind: req.Kind, Amount: req.Amount, Destination: strings.TrimSpace(req.Destination), Status: "requested", CreatedAt: time.Now().UTC()}
	err := s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		field := "deposits"
		if req.Kind == "withdrawal" {
			field = "earnings"
			var profile models.FreelancerProfile
			if err := s.store.C("freelancer_profiles").FindOne(sc, bson.M{"_id": user.ID, "identity_status": "verified"}).Decode(&profile); err != nil {
				return marketInvalid("Identity verification must be approved before withdrawal")
			}
		}
		result, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": user.ID, field: bson.M{"$gte": req.Amount}}, bson.M{"$inc": bson.M{field: -req.Amount}})
		if err != nil {
			return err
		}
		if result.ModifiedCount != 1 {
			return marketInvalid("Insufficient available balance. Earnings unlock seven days after approval")
		}
		_, err = s.store.C("marketplace_transfers").InsertOne(sc, transfer)
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(201, gin.H{"transfer": transfer})
	}
}

func (s *Server) marketplaceOwner(c *gin.Context) bool {
	user, _ := currentUser(c)
	if user.Role != models.RoleOwnerAdmin {
		c.JSON(403, gin.H{"error": "Platform owner access required"})
		return false
	}
	account, err := s.loadUser(c.Request.Context(), user.ID)
	if err != nil || account.Role != models.RoleOwnerAdmin || account.Status == models.StatusSuspended {
		c.JSON(403, gin.H{"error": "Platform owner access required"})
		return false
	}
	return true
}

func (s *Server) marketplaceAdmin(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	ctx := c.Request.Context()
	cur, err := s.store.C("marketplace_transfers").Find(ctx, bson.M{"status": "requested"}, options.Find().SetLimit(200).SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	transfers := []models.MarketplaceTransfer{}
	if marketplaceError(c, cur.All(ctx, &transfers)) {
		return
	}
	profiles, err := s.store.C("freelancer_profiles").Find(ctx, bson.M{"identity_status": "pending"}, options.Find().SetLimit(200))
	if marketplaceError(c, err) {
		return
	}
	defer profiles.Close(ctx)
	pending := []models.FreelancerProfile{}
	if marketplaceError(c, profiles.All(ctx, &pending)) {
		return
	}
	fees, err := s.store.C("marketplace_earnings").Aggregate(ctx, mongo.Pipeline{{{Key: "$group", Value: bson.M{"_id": nil, "total": bson.M{"$sum": "$fee"}}}}})
	if marketplaceError(c, err) {
		return
	}
	defer fees.Close(ctx)
	var totals []struct {
		Total int64 `bson:"total"`
	}
	if marketplaceError(c, fees.All(ctx, &totals)) {
		return
	}
	total := int64(0)
	if len(totals) > 0 {
		total = totals[0].Total
	}
	c.JSON(200, gin.H{"transfers": transfers, "profiles": pending, "commission": total})
}

func (s *Server) marketplaceReviewIdentity(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	var req struct {
		Status   string             `json:"status"`
		Revision primitive.ObjectID `json:"revision"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Revision.IsZero() || (req.Status != "verified" && req.Status != "rejected") {
		marketplaceError(c, marketInvalid("Choose verified or rejected"))
		return
	}
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		result, err := s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": id, "identity_status": "pending", "identity_revision": req.Revision}, bson.M{"$set": bson.M{"identity_status": req.Status}})
		if err != nil {
			return err
		}
		if result.ModifiedCount != 1 {
			return marketInvalid("No pending identity submission")
		}
		result, err = s.store.C("marketplace_identity").UpdateOne(sc, bson.M{"_id": id, "revision": req.Revision}, bson.M{"$set": bson.M{"reviewed_by": user.ID, "reviewed_at": time.Now().UTC(), "status": req.Status}})
		if err == nil && result.MatchedCount != 1 {
			return marketInvalid("Identity document changed. Reload and review the current submission")
		}
		return err
	})
	if !marketplaceError(c, err) {
		s.audit(c.Request.Context(), user.ID, "identity_"+req.Status, "user", id)
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) marketplaceSettleTransfer(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	var req struct {
		Status    string `json:"status"`
		Reference string `json:"reference"`
		Fee       int64  `json:"fee"`
	}
	if c.ShouldBindJSON(&req) != nil || (req.Status != "paid" && req.Status != "rejected") || req.Fee < 0 || len(req.Reference) > 200 || (req.Status == "paid" && len(strings.TrimSpace(req.Reference)) < 5) {
		marketplaceError(c, marketInvalid("Provide a real transaction reference and actual transaction fee for completed payments"))
		return
	}
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		var t models.MarketplaceTransfer
		if err := s.store.C("marketplace_transfers").FindOne(sc, bson.M{"_id": id, "status": "requested", "kind": bson.M{"$in": []string{"refund", "withdrawal"}}}).Decode(&t); err != nil {
			return err
		}
		if req.Fee >= t.Amount {
			return marketInvalid("Transaction fee must be less than the requested amount")
		}
		if req.Status == "rejected" {
			field := "deposits"
			if t.Kind == "withdrawal" {
				field = "earnings"
			}
			_, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": t.UserID}, bson.M{"$inc": bson.M{field: t.Amount}})
			if err != nil {
				return err
			}
			req.Fee = 0
		}
		set := bson.M{"status": req.Status, "fee": req.Fee, "settled_by": user.ID, "settled_at": time.Now().UTC()}
		if req.Status == "paid" {
			set["external_id"] = strings.TrimSpace(req.Reference)
		}
		_, err := s.store.C("marketplace_transfers").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": set})
		if err != nil {
			return err
		}
		return s.marketplaceNotify(sc, t.UserID, id, "marketplace_wallet", "Your "+t.Kind+" request was "+req.Status+". View your wallet for the transaction details.")
	})
	if !marketplaceError(c, err) {
		s.audit(c.Request.Context(), user.ID, "marketplace_transfer_"+req.Status, "marketplace_transfer", id)
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) marketplacePrivacy(c *gin.Context) {
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	policy, err := s.loadConnectsPolicy(c.Request.Context())
	if marketplaceError(c, err) {
		return
	}
	c.HTML(200, "marketplace_privacy.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": "Marketplace privacy and payment terms", "Year": time.Now().Year(), "Version": marketplaceConsentVersion, "ConnectsAmount": policy.Amount, "ConnectsPeriod": policy.Period}))
}
