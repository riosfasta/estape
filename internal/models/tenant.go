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
	Status            TenantStatus        `bson:"status" json:"status"`
	CustomDomain      string              `bson:"custom_domain,omitempty" json:"custom_domain,omitempty"`
	CloudflareProject string              `bson:"cloudflare_project,omitempty" json:"cloudflare_project,omitempty"`
	CloudflareURL     string              `bson:"cloudflare_url,omitempty" json:"cloudflare_url,omitempty"`
	PublishedAt       *time.Time          `bson:"published_at,omitempty" json:"published_at,omitempty"`
	SMTP              TenantSMTPSettings  `bson:"smtp,omitempty" json:"smtp,omitempty"`
	AutoResponder     TenantAutoResponder `bson:"auto_responder,omitempty" json:"auto_responder,omitempty"`
	CreatedAt         time.Time           `bson:"created_at" json:"created_at"`
	UpdatedAt         time.Time           `bson:"updated_at" json:"updated_at"`
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
