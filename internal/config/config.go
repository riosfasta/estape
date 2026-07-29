package config

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName               string
	AppURL                string
	Port                  string
	MongoURI              string
	MongoDBName           string
	JWTSecret             string
	UploadDir             string
	OwnerName             string
	OwnerEmail            string
	OwnerPassword         string
	SMTPHost              string
	SMTPPort              string
	SMTPUser              string
	SMTPPassword          string
	SMTPFrom              string
	GoogleClientID        string
	GoogleClientSecret    string
	GoogleRedirectURL     string
	StripePublishableKey  string
	StripeSecretKey       string
	StripeWebhookSecret   string
	PayPalClientID        string
	PayPalClientSecret    string
	PayPalWebhookID       string
	PayPalMode            string
	FCMProjectID          string
	FCMServiceAccount     string
	FCMServiceAccountFile string
}

func Load() Config {
	_ = godotenv.Load()

	port := env("PORT", "8080")
	appURL := strings.TrimRight(env("APP_URL", "http://localhost:"+port), "/")
	return Config{
		AppName:               env("APP_NAME", "PinFlow"),
		AppURL:                appURL,
		Port:                  port,
		MongoURI:              env("MONGO_URI", "mongodb://localhost:27017/"),
		MongoDBName:           env("MONGO_DB_NAME", "bugmarking"),
		JWTSecret:             env("JWT_SECRET", "local-dev-secret-change-me"),
		UploadDir:             env("UPLOAD_DIR", "uploads"),
		OwnerName:             env("OWNER_NAME", "Platform Owner"),
		OwnerEmail:            strings.ToLower(env("OWNER_EMAIL", "owner@pinflow.local")),
		OwnerPassword:         env("OWNER_PASSWORD", "ChangeMe123!"),
		SMTPHost:              env("SMTP_HOST", ""),
		SMTPPort:              env("SMTP_PORT", "587"),
		SMTPUser:              env("SMTP_USER", ""),
		SMTPPassword:          env("SMTP_PASSWORD", ""),
		SMTPFrom:              env("SMTP_FROM", "no-reply@pinflow.local"),
		GoogleClientID:        env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:    env("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:     env("GOOGLE_REDIRECT_URL", appURL+"/api/auth/google/callback"),
		StripePublishableKey:  env("STRIPE_PUBLISHABLE_KEY", ""),
		StripeSecretKey:       env("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret:   env("STRIPE_WEBHOOK_SECRET", ""),
		PayPalClientID:        env("PAYPAL_CLIENT_ID", ""),
		PayPalClientSecret:    env("PAYPAL_CLIENT_SECRET", ""),
		PayPalWebhookID:       env("PAYPAL_WEBHOOK_ID", ""),
		PayPalMode:            env("PAYPAL_MODE", "sandbox"),
		FCMProjectID:          env("FCM_PROJECT_ID", ""),
		FCMServiceAccount:     env("FCM_SERVICE_ACCOUNT_JSON", ""),
		FCMServiceAccountFile: env("FCM_SERVICE_ACCOUNT_FILE", ""),
	}
}

func env(key string, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}
