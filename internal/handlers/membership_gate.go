package handlers

import (
	"context"
	"net/http"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const defaultTrialDays = 14

func (s *Server) membershipPlans(ctx context.Context) []models.Plan {
	cursor, err := s.store.C("plans").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "price", Value: 1}, {Key: "price_per_seat", Value: 1}}))
	if err != nil {
		return []models.Plan{}
	}
	defer cursor.Close(ctx)
	plans := []models.Plan{}
	if err := cursor.All(ctx, &plans); err != nil {
		return []models.Plan{}
	}
	return plans
}

func (s *Server) teamMembership(ctx context.Context, teamID primitive.ObjectID) (models.Subscription, models.Plan, string) {
	if teamID.IsZero() {
		return models.Subscription{}, models.Plan{}, "no_membership"
	}
	now := time.Now()
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": teamID}).Decode(&team); err != nil {
		return models.Subscription{}, models.Plan{}, "no_membership"
	}

	var sub models.Subscription
	if !team.SubscriptionID.IsZero() {
		if err := s.store.C("subscriptions").FindOne(ctx, bson.M{"_id": team.SubscriptionID}).Decode(&sub); err != nil && err != mongo.ErrNoDocuments {
			return models.Subscription{}, models.Plan{}, "unknown"
		}
	}
	if !membershipAllowsAccess(sub, now) {
		var fallback models.Subscription
		err := s.store.C("subscriptions").FindOne(
			ctx,
			bson.M{
				"team_id": teamID,
				"status":  bson.M{"$in": []string{"active", "trialing"}},
				"$or": []bson.M{
					{"expires_at": bson.M{"$exists": false}},
					{"expires_at": nil},
					{"expires_at": bson.M{"$gt": now}},
				},
			},
			options.FindOne().SetSort(bson.D{{Key: "created_at", Value: -1}}),
		).Decode(&fallback)
		if err == nil && membershipAllowsAccess(fallback, now) {
			sub = fallback
		}
	}

	status := membershipStatus(sub, now)
	var plan models.Plan
	if !sub.PlanID.IsZero() {
		_ = s.store.C("plans").FindOne(ctx, bson.M{"_id": sub.PlanID}).Decode(&plan)
	}
	return sub, plan, status
}

func membershipAllowsAccess(sub models.Subscription, now time.Time) bool {
	status := membershipStatus(sub, now)
	return status == "active" || status == "trialing"
}

func membershipStatus(sub models.Subscription, now time.Time) string {
	if sub.ID.IsZero() {
		return "no_membership"
	}
	if sub.ExpiresAt != nil && now.After(*sub.ExpiresAt) {
		return "expired"
	}
	if sub.Status == "trialing" {
		if sub.TrialEndsAt != nil && now.After(*sub.TrialEndsAt) {
			return "expired"
		}
		return "trialing"
	}
	if sub.Status == "" {
		return "unknown"
	}
	return sub.Status
}

func (s *Server) membershipAccessPayload(ctx context.Context, teamID primitive.ObjectID) gin.H {
	sub, plan, status := s.teamMembership(ctx, teamID)
	payload := gin.H{
		"status":          status,
		"allowed":         status == "active" || status == "trialing",
		"trial":           status == "trialing",
		"trial_days":      defaultTrialDays,
		"plans":           s.membershipPlans(ctx),
		"subscription_id": "",
		"plan":            nil,
	}
	if !sub.ID.IsZero() {
		payload["subscription_id"] = sub.ID
		payload["billing_period"] = sub.BillingPeriod
		payload["billing_quantity"] = sub.BillingQuantity
		payload["payment_provider"] = sub.PaymentProvider
		payload["external_transaction_id"] = sub.ExternalTransactionID
		payload["started_at"] = sub.StartedAt
		payload["created_at"] = sub.CreatedAt
		payload["trial_ends_at"] = sub.TrialEndsAt
		payload["expires_at"] = sub.ExpiresAt
	}
	if !plan.ID.IsZero() {
		payload["plan"] = plan
	}
	return payload
}

func (s *Server) requireTeamFeatureAccess(c *gin.Context, teamID primitive.ObjectID, feature string) bool {
	if feature != "website feedback" && feature != "annotations" {
		return true
	}
	userCtx, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return false
	}
	if userCtx.Role == models.RoleOwnerAdmin {
		return true
	}
	payload := s.membershipAccessPayload(c.Request.Context(), teamID)
	if allowed, _ := payload["allowed"].(bool); allowed {
		return true
	}
	payload["error"] = "membership required"
	payload["code"] = "membership_required"
	payload["feature"] = feature
	c.JSON(http.StatusPaymentRequired, payload)
	return false
}
