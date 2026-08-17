package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/config"
	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	mongomodels "go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

type Store struct {
	Client *mongo.Client
	DB     *mongo.Database
}

func defaultOwnerNotificationEmail(cfg config.Config) string {
	if strings.TrimSpace(cfg.OwnerEmail) != "" {
		return strings.TrimSpace(cfg.OwnerEmail)
	}
	return strings.TrimSpace(cfg.SMTPFrom)
}

func Connect(ctx context.Context, cfg config.Config) (*Store, error) {
	client, err := mongo.Connect(ctx, mongomodels.Client().ApplyURI(cfg.MongoURI))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		return nil, err
	}
	return &Store{Client: client, DB: client.Database(cfg.MongoDBName)}, nil
}

func (s *Store) C(name string) *mongo.Collection {
	return s.DB.Collection(name)
}

func (s *Store) CreateIndexes(ctx context.Context) error {
	indexes := map[string][]mongo.IndexModel{
		"users": {
			{Keys: bson.D{{Key: "email", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "username", Value: 1}}, Options: mongomodels.Index().SetUnique(true).SetSparse(true)},
			{Keys: bson.D{{Key: "team_id", Value: 1}}},
		},
		"team_invitations": {
			{Keys: bson.D{{Key: "token", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "email", Value: 1}, {Key: "team_id", Value: 1}, {Key: "status", Value: 1}}},
			{Keys: bson.D{{Key: "existing_user_id", Value: 1}, {Key: "status", Value: 1}}},
		},
		"notifications": {
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "read", Value: 1}, {Key: "created_at", Value: -1}}},
		},
		"push_devices": {
			{Keys: bson.D{{Key: "token", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "enabled", Value: 1}}},
		},
		"tasks": {
			{Keys: bson.D{{Key: "list_id", Value: 1}}},
			{Keys: bson.D{{Key: "assignee_ids", Value: 1}}},
			{Keys: bson.D{{Key: "status", Value: 1}}},
		},
		"bugs": {
			{Keys: bson.D{{Key: "website_id", Value: 1}}},
			{Keys: bson.D{{Key: "status", Value: 1}}},
		},
		"messages": {
			{Keys: bson.D{{Key: "chat_id", Value: 1}, {Key: "sent_at", Value: 1}}},
		},
		"subscriptions": {
			{Keys: bson.D{{Key: "team_id", Value: 1}}},
		},
		"plans": {
			{Keys: bson.D{{Key: "name", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
		},
		"websites": {
			{Keys: bson.D{{Key: "team_id", Value: 1}}},
		},
		"client_websites": {
			{Keys: bson.D{{Key: "widget_key", Value: 1}}, Options: mongomodels.Index().SetUnique(true).SetSparse(true)},
			{Keys: bson.D{{Key: "client_id", Value: 1}}},
			{Keys: bson.D{{Key: "team_id", Value: 1}}},
		},
		"static_pages": {
			{Keys: bson.D{{Key: "slug", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
		},
		"integrations": {
			{Keys: bson.D{{Key: "team_id", Value: 1}, {Key: "provider", Value: 1}}, Options: mongomodels.Index().SetUnique(true)},
		},
		"time_entries": {
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "end_time", Value: 1}}},
			{Keys: bson.D{{Key: "team_id", Value: 1}, {Key: "start_time", Value: -1}}},
			{Keys: bson.D{{Key: "task_id", Value: 1}}},
		},
	}

	for collection, models := range indexes {
		if len(models) == 0 {
			continue
		}
		if _, err := s.C(collection).Indexes().CreateMany(ctx, models); err != nil {
			return fmt.Errorf("%s: %w", collection, err)
		}
	}
	return nil
}

func (s *Store) Seed(ctx context.Context, cfg config.Config) error {
	now := time.Now()
	if err := s.seedPlans(ctx, now); err != nil {
		return err
	}
	if err := s.backfillPlanYearlyPrices(ctx); err != nil {
		return err
	}
	if err := s.seedOwner(ctx, cfg, now); err != nil {
		return err
	}
	if err := s.seedSettings(ctx, cfg, now); err != nil {
		return err
	}
	if err := s.disableStripeSettings(ctx); err != nil {
		return err
	}
	return s.seedPages(ctx, now)
}

func (s *Store) seedPlans(ctx context.Context, now time.Time) error {
	return s.ensureSingleWebsitePlan(ctx, now)
}

func (s *Store) ensureSingleWebsitePlan(ctx context.Context, now time.Time) error {
	plan := models.Plan{}
	err := s.C("plans").FindOne(ctx, bson.M{"name": "Website Package"}).Decode(&plan)
	if err == mongo.ErrNoDocuments {
		err = s.C("plans").FindOne(
			ctx,
			bson.M{},
			mongomodels.FindOne().SetSort(bson.D{{Key: "featured", Value: -1}, {Key: "created_at", Value: 1}}),
		).Decode(&plan)
	}
	if err == mongo.ErrNoDocuments {
		plan = models.Plan{ID: primitive.NewObjectID(), CreatedAt: now}
		if _, err := s.C("plans").InsertOne(ctx, plan); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	set := bson.M{
		"name":                  "Website Package",
		"description":           "One flat package for website feedback, tasks, team access, reports, and project management.",
		"pricing_model":         "flat",
		"price":                 int64(500),
		"price_yearly":          int64(3500),
		"price_per_seat":        int64(0),
		"price_per_seat_yearly": int64(0),
		"trial_days":            14,
		"seat_limit":            25,
		"project_limit":         100,
		"storage_limit_mb":      10240,
		"featured":              true,
	}
	if plan.CreatedAt.IsZero() {
		set["created_at"] = now
	}
	if _, err := s.C("plans").UpdateByID(ctx, plan.ID, bson.M{"$set": set}); err != nil {
		return err
	}
	if _, err := s.C("subscriptions").UpdateMany(ctx, bson.M{"plan_id": bson.M{"$ne": plan.ID}}, bson.M{"$set": bson.M{"plan_id": plan.ID}}); err != nil {
		return err
	}
	_, err = s.C("plans").DeleteMany(ctx, bson.M{"_id": bson.M{"$ne": plan.ID}})
	return err
}

func (s *Store) backfillPlanYearlyPrices(ctx context.Context) error {
	cursor, err := s.C("plans").Find(ctx, bson.M{})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var plan models.Plan
		if err := cursor.Decode(&plan); err != nil {
			return err
		}
		set := bson.M{}
		if plan.PriceYearly <= 0 && plan.Price > 0 {
			set["price_yearly"] = plan.Price * 12
		}
		if plan.PricePerSeatYearly <= 0 && plan.PricePerSeat > 0 {
			set["price_per_seat_yearly"] = plan.PricePerSeat * 12
		}
		if len(set) > 0 {
			if _, err := s.C("plans").UpdateByID(ctx, plan.ID, bson.M{"$set": set}); err != nil {
				return err
			}
		}
	}
	return cursor.Err()
}

func (s *Store) seedOwner(ctx context.Context, cfg config.Config, now time.Time) error {
	email := strings.ToLower(strings.TrimSpace(cfg.OwnerEmail))
	count, err := s.C("users").CountDocuments(ctx, bson.M{"email": email})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := auth.HashPassword(cfg.OwnerPassword)
	if err != nil {
		return err
	}
	owner := models.User{
		ID:              primitive.NewObjectID(),
		Name:            cfg.OwnerName,
		Email:           email,
		Username:        "owner",
		PasswordHash:    hash,
		Role:            models.RoleOwnerAdmin,
		StaffRole:       "manager",
		Status:          models.StatusActive,
		ThemePreference: "system",
		CreatedAt:       now,
	}
	_, err = s.C("users").InsertOne(ctx, owner)
	return err
}

func (s *Store) seedSettings(ctx context.Context, cfg config.Config, now time.Time) error {
	count, err := s.C("site_settings").CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	settings := models.SiteSettings{
		ID:                      primitive.NewObjectID(),
		SiteName:                cfg.AppName,
		CompanySlogan:           "Task management with visual website feedback",
		CompanyEmail:            "support@bugmega.local",
		CompanyContact:          "support@bugmega.local",
		OwnerName:               cfg.OwnerName,
		CompanyAddress:          "Set your company address in Admin Settings",
		TimeZone:                "UTC",
		GoogleSigninEnabled:     cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "",
		GoogleClientID:          cfg.GoogleClientID,
		GoogleClientSecret:      cfg.GoogleClientSecret,
		GoogleRedirectURL:       cfg.GoogleRedirectURL,
		SMTPEnabled:             cfg.SMTPHost != "" && cfg.SMTPUser != "",
		SMTPHost:                cfg.SMTPHost,
		SMTPPort:                cfg.SMTPPort,
		SMTPUser:                cfg.SMTPUser,
		SMTPPassword:            cfg.SMTPPassword,
		SMTPFrom:                cfg.SMTPFrom,
		OwnerNotificationEmail:  defaultOwnerNotificationEmail(cfg),
		OwnerNotifyRegistration: true,
		OwnerNotifyPurchase:     true,
		OwnerNotifyNewChat:      true,
		OwnerNotificationsSet:   false,
		StripeEnabled:           false,
		PayPalEnabled:           cfg.PayPalClientID != "" && cfg.PayPalClientSecret != "",
		PayPalMode:              cfg.PayPalMode,
		PayPalClientID:          cfg.PayPalClientID,
		PayPalClientSecret:      cfg.PayPalClientSecret,
		PayPalWebhookID:         cfg.PayPalWebhookID,
		PublicNavCompanyName:    cfg.AppName,
		PublicNavButtonText:     "Get Started",
		PublicNavButtonURL:      "/register",
		PublicNavButtonStyle:    "primary",
		PublicNavItems: []models.PublicNavItem{
			{ID: "home", Label: "Home", URL: "/", Visible: true, Order: 1},
			{ID: "pricing", Label: "Pricing", URL: "/pricing", Visible: true, Order: 2},
			{ID: "login", Label: "Login", URL: "/login", Visible: true, Order: 3},
		},
		UpdatedAt: now,
	}
	_, err = s.C("site_settings").InsertOne(ctx, settings)
	return err
}

func (s *Store) disableStripeSettings(ctx context.Context) error {
	_, err := s.C("site_settings").UpdateMany(
		ctx,
		bson.M{},
		bson.M{
			"$set": bson.M{
				"stripe_enabled":         false,
				"stripe_publishable_key": "",
			},
			"$unset": bson.M{
				"stripe_secret_key":     "",
				"stripe_webhook_secret": "",
			},
		},
	)
	return err
}

func (s *Store) seedPages(ctx context.Context, now time.Time) error {
	count, err := s.C("static_pages").CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	pages := []interface{}{
		models.StaticPage{
			ID:     primitive.NewObjectID(),
			Slug:   "terms-of-service",
			Title:  "Terms of Service",
			Status: "published",
			Blocks: []models.PageBlock{
				{ID: "terms-heading", Type: "heading", Props: map[string]interface{}{"text": "Terms of Service", "level": "h1"}},
				{ID: "terms-text", Type: "rich_text", Props: map[string]interface{}{"text": "These terms are a starter template for [[site_name]]. Update them in the owner page builder before public launch."}},
			},
			RenderedHTMLCache: `<section class="legal-section"><h1>Terms of Service</h1><p>These terms are a starter template for bugmega. Update them in the owner page builder before public launch.</p></section>`,
			UpdatedAt:         now,
		},
		models.StaticPage{
			ID:     primitive.NewObjectID(),
			Slug:   "privacy-policy",
			Title:  "Privacy Policy",
			Status: "published",
			Blocks: []models.PageBlock{
				{ID: "privacy-heading", Type: "heading", Props: map[string]interface{}{"text": "Privacy Policy", "level": "h1"}},
				{ID: "privacy-text", Type: "rich_text", Props: map[string]interface{}{"text": "This privacy policy is a starter template. Add your data handling details before public launch."}},
			},
			RenderedHTMLCache: `<section class="legal-section"><h1>Privacy Policy</h1><p>This privacy policy is a starter template. Add your data handling details before public launch.</p></section>`,
			UpdatedAt:         now,
		},
	}
	_, err = s.C("static_pages").InsertMany(ctx, pages)
	return err
}
