package handlers

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type connectsPolicy struct {
	Amount    int       `bson:"amount" json:"amount"`
	Period    string    `bson:"period" json:"period"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}

func connectsPeriod(now time.Time, period string) (time.Time, time.Time) {
	start := marketplaceWeek(now)
	if period == "monthly" {
		now = now.UTC()
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start, start.AddDate(0, 1, 0)
	}
	return start, start.AddDate(0, 0, 7)
}

func (s *Server) loadConnectsPolicy(ctx context.Context) (connectsPolicy, error) {
	var policy connectsPolicy
	err := s.store.C("marketplace_settings").FindOne(ctx, bson.M{"_id": "connects"}).Decode(&policy)
	if err == mongo.ErrNoDocuments {
		return connectsPolicy{Amount: 100, Period: "weekly"}, nil
	}
	return policy, err
}

func (s *Server) adminConnects(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	ctx := c.Request.Context()
	policy, err := s.loadConnectsPolicy(ctx)
	if marketplaceError(c, err) {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		page = 10000
	}
	filter := bson.M{}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if len(q) > 100 {
			q = q[:100]
		}
		rx := bson.M{"$regex": regexp.QuoteMeta(q), "$options": "i"}
		filter["$or"] = []bson.M{{"name": rx}, {"email": rx}, {"username": rx}}
	}
	cur, err := s.store.C("users").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1, "name": 1, "email": 1}).SetSort(bson.D{{Key: "name", Value: 1}, {Key: "_id", Value: 1}}).SetSkip(int64((page-1)*50)).SetLimit(51))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	users := []models.User{}
	if marketplaceError(c, cur.All(ctx, &users)) {
		return
	}
	more := len(users) > 50
	if more {
		users = users[:50]
	}
	out := []gin.H{}
	for _, u := range users {
		out = append(out, gin.H{"id": u.ID, "name": u.Name, "email": u.Email})
	}
	history, err := s.store.C("marketplace_connect_grants").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(20))
	if marketplaceError(c, err) {
		return
	}
	defer history.Close(ctx)
	grants := []bson.M{}
	if marketplaceError(c, history.All(ctx, &grants)) {
		return
	}
	c.JSON(200, gin.H{"policy": policy, "users": out, "page": page, "has_more": more, "grants": grants})
}

func (s *Server) saveConnectsPolicy(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	var req struct {
		Amount *int   `json:"amount"`
		Period string `json:"period"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Amount == nil || *req.Amount < 0 || *req.Amount > 100000 || (req.Period != "weekly" && req.Period != "monthly") {
		marketplaceError(c, marketInvalid("Choose an allowance from 0 to 100,000 and a weekly or monthly reset"))
		return
	}
	user, _ := currentUser(c)
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		old, err := s.loadConnectsPolicy(sc)
		if err != nil {
			return err
		}
		if old.Amount == *req.Amount && old.Period == req.Period {
			return nil
		}
		policy := connectsPolicy{Amount: *req.Amount, Period: req.Period, UpdatedAt: time.Now().UTC()}
		_, err = s.store.C("marketplace_settings").UpdateOne(sc, bson.M{"_id": "connects"}, bson.M{"$set": policy}, options.Update().SetUpsert(true))
		if err != nil {
			return err
		}
		_, err = s.store.C("audit_logs").InsertOne(sc, bson.M{"actor_id": user.ID, "action": "connects_policy_updated", "before": old, "after": policy, "timestamp": policy.UpdatedAt})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) grantConnects(c *gin.Context) {
	if !s.marketplaceOwner(c) {
		return
	}
	var req struct {
		UserIDs   []string `json:"user_ids"`
		Amount    int      `json:"amount"`
		Reason    string   `json:"reason"`
		RequestID string   `json:"request_id"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Amount < 1 || req.Amount > 100000 || len(req.UserIDs) < 1 || len(req.UserIDs) > 200 || len(strings.TrimSpace(req.Reason)) < 3 || len(req.Reason) > 500 || len(req.RequestID) < 16 || len(req.RequestID) > 80 {
		marketplaceError(c, marketInvalid("Select 1–200 users, enter 1–100,000 Connects per user and a reason"))
		return
	}
	ids := []primitive.ObjectID{}
	seen := map[primitive.ObjectID]bool{}
	for _, raw := range req.UserIDs {
		id, err := primitive.ObjectIDFromHex(raw)
		if err != nil || id.IsZero() {
			marketplaceError(c, marketInvalid("Invalid user ID"))
			return
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	actor, _ := currentUser(c)
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		// Unique request key and credits commit together; retries cannot grant twice.
		_, err := s.store.C("marketplace_connect_grants").InsertOne(sc, bson.M{"_id": req.RequestID, "actor_id": actor.ID, "user_ids": ids, "amount": req.Amount, "reason": strings.TrimSpace(req.Reason), "created_at": time.Now().UTC()})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err = s.ensureMarketplaceProfile(sc, id); err != nil {
				return err
			}
			result, err := s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": id, "connects": bson.M{"$lte": 1000000 - req.Amount}}, bson.M{"$inc": bson.M{"connects": req.Amount}})
			if err != nil {
				return err
			}
			if result.ModifiedCount != 1 {
				return marketInvalid("A selected account would exceed the 1,000,000 Connect balance limit")
			}
		}
		return nil
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"granted": len(ids), "amount_each": req.Amount})
	}
}
