package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type TenantStatus string

const (
	TenantStatusDraft     TenantStatus = "draft"
	TenantStatusActive    TenantStatus = "active"
	TenantStatusSuspended TenantStatus = "suspended"
	TenantStatusDeleted   TenantStatus = "deleted"
)

type TenantSMTPSettings struct {
	Host      string `bson:"host" json:"host"`
	Port      int    `bson:"port" json:"port"`
	Username  string `bson:"username" json:"username"`
	Password  string `bson:"password" json:"password"`
	FromName  string `bson:"from_name" json:"from_name"`
	FromEmail string `bson:"from_email" json:"from_email"`
	Enabled   bool   `bson:"enabled" json:"enabled"`
}

type TenantAutoResponder struct {
	Enabled bool   `bson:"enabled" json:"enabled"`
	Subject string `bson:"subject" json:"subject"`
	Body    string `bson:"body" json:"body"`
}

type Tenant struct {
	ID                primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	OwnerUserID       primitive.ObjectID  `bson:"owner_user_id" json:"owner_user_id"`
	Subdomain         string              `bson:"subdomain" json:"subdomain"`
	CompanyName       string              `bson:"company_name" json:"company_name"`
	ActiveTheme       string              `bson:"active_theme" json:"active_theme"`
	MarketThemeSlug   string              `bson:"market_theme_slug,omitempty" json:"market_theme_slug,omitempty"`
	MarketThemeName   string              `bson:"market_theme_name,omitempty" json:"market_theme_name,omitempty"`
	Status            TenantStatus        `bson:"status" json:"status"`
	CustomDomain           string              `bson:"custom_domain,omitempty" json:"custom_domain,omitempty"`
	CustomDomainStatus     string              `bson:"custom_domain_status,omitempty" json:"custom_domain_status,omitempty"`
	CustomDomainVerifiedAt *time.Time          `bson:"custom_domain_verified_at,omitempty" json:"custom_domain_verified_at,omitempty"`
	CustomDomainPaid       bool                `bson:"custom_domain_paid" json:"custom_domain_paid"`
	CustomDomainPlan       string              `bson:"custom_domain_plan,omitempty" json:"custom_domain_plan,omitempty"`
	CustomDomainPaidUntil  *time.Time          `bson:"custom_domain_paid_until,omitempty" json:"custom_domain_paid_until,omitempty"`
	CustomDomainPaymentID  string              `bson:"custom_domain_payment_id,omitempty" json:"custom_domain_payment_id,omitempty"`
	SSLStatus              string              `bson:"ssl_status,omitempty" json:"ssl_status,omitempty"`
	SSLVerifiedAt          *time.Time          `bson:"ssl_verified_at,omitempty" json:"ssl_verified_at,omitempty"`
	SSLLastError           string              `bson:"ssl_last_error,omitempty" json:"ssl_last_error,omitempty"`
	SSLCertIssuer          string              `bson:"ssl_cert_issuer,omitempty" json:"ssl_cert_issuer,omitempty"`
	CloudflareProject      string              `bson:"cloudflare_project,omitempty" json:"cloudflare_project,omitempty"`
	CloudflareURL     string              `bson:"cloudflare_url,omitempty" json:"cloudflare_url,omitempty"`
	PublishedAt       *time.Time          `bson:"published_at,omitempty" json:"published_at,omitempty"`
	SMTP              TenantSMTPSettings  `bson:"smtp,omitempty" json:"smtp,omitempty"`
	AutoResponder     TenantAutoResponder `bson:"auto_responder,omitempty" json:"auto_responder,omitempty"`
	IsDeleted         bool                `bson:"is_deleted" json:"is_deleted"`
	DeletedAt         *time.Time          `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
	PurgeAt           *time.Time          `bson:"purge_at,omitempty" json:"purge_at,omitempty"`
	DeletedBy         *primitive.ObjectID `bson:"deleted_by,omitempty" json:"deleted_by,omitempty"`
	ClientHidden      bool                `bson:"client_hidden,omitempty" json:"client_hidden,omitempty"`
	ClientUnlistedAt  *time.Time          `bson:"client_unlisted_at,omitempty" json:"client_unlisted_at,omitempty"`
	CreatedAt         time.Time           `bson:"created_at" json:"created_at"`
	UpdatedAt         time.Time           `bson:"updated_at" json:"updated_at"`
}

type WebsiteTheme struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Slug          string             `bson:"slug" json:"slug"`
	Name          string             `bson:"name" json:"name"`
	Description   string             `bson:"description,omitempty" json:"description,omitempty"`
	Category      string             `bson:"category,omitempty" json:"category,omitempty"`
	BaseTheme     string             `bson:"base_theme" json:"base_theme"`
	PreviewImage  string             `bson:"preview_image,omitempty" json:"preview_image,omitempty"`
	GithubURL     string             `bson:"github_url,omitempty" json:"github_url,omitempty"`
	GithubBranch  string             `bson:"github_branch,omitempty" json:"github_branch,omitempty"`
	LastCommitSHA string             `bson:"last_commit_sha,omitempty" json:"last_commit_sha,omitempty"`
	LastSyncedAt  *time.Time         `bson:"last_synced_at,omitempty" json:"last_synced_at,omitempty"`
	BrandName     string             `bson:"brand_name,omitempty" json:"brand_name,omitempty"`
	Tagline       string             `bson:"tagline,omitempty" json:"tagline,omitempty"`
	AccentColor   string             `bson:"accent_color,omitempty" json:"accent_color,omitempty"`
	IsDefault     bool               `bson:"is_default" json:"is_default"`
	IsActive      bool               `bson:"is_active" json:"is_active"`
	SortOrder     int                `bson:"sort_order" json:"sort_order"`
	CreatedBy     primitive.ObjectID `bson:"created_by,omitempty" json:"created_by,omitempty"`
	CreatedAt     time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt     time.Time          `bson:"updated_at" json:"updated_at"`
}

type TenantFormSubmission struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID          primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	TenantSubdomain   string             `bson:"tenant_subdomain" json:"tenant_subdomain"`
	FormName          string             `bson:"form_name" json:"form_name"`
	Fields            map[string]string  `bson:"fields" json:"fields"`
	VisitorEmail      string             `bson:"visitor_email,omitempty" json:"visitor_email,omitempty"`
	VisitorName       string             `bson:"visitor_name,omitempty" json:"visitor_name,omitempty"`
	AutoResponderSent bool               `bson:"auto_responder_sent" json:"auto_responder_sent"`
	CreatedAt         time.Time          `bson:"created_at" json:"created_at"`
}

type StoreCustomer struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID     primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	Email        string             `bson:"email" json:"email"`
	PasswordHash string             `bson:"password_hash" json:"-"`
	FullName     string             `bson:"full_name" json:"full_name"`
	Status       string             `bson:"status" json:"status"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
}

type TenantDomainOrder struct {
	ID                    primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID              primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	OwnerUserID           primitive.ObjectID `bson:"owner_user_id" json:"owner_user_id"`
	BillingPeriod         string             `bson:"billing_period" json:"billing_period"`
	Amount                int64              `bson:"amount" json:"amount"`
	Currency              string             `bson:"currency" json:"currency"`
	Status                string             `bson:"status" json:"status"`
	PaymentProvider       string             `bson:"payment_provider" json:"payment_provider"`
	PaymentReference      string             `bson:"payment_reference" json:"payment_reference"`
	ExternalTransactionID string             `bson:"external_transaction_id,omitempty" json:"external_transaction_id,omitempty"`
	CaptureID             string             `bson:"capture_id,omitempty" json:"capture_id,omitempty"`
	PaidAt                *time.Time         `bson:"paid_at,omitempty" json:"paid_at,omitempty"`
	ExpiresAt             *time.Time         `bson:"expires_at,omitempty" json:"expires_at,omitempty"`
	CreatedAt             time.Time          `bson:"created_at" json:"created_at"`
}
