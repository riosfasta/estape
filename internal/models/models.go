package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Role string

const (
	RoleOwnerAdmin  Role = "owner_adm"
	RoleTeamAdmin   Role = "users_admin"
	RoleMember      Role = "users_member"
	RoleClientAdmin Role = "client_admin"
)

type UserStatus string

const (
	StatusActive    UserStatus = "active"
	StatusPending   UserStatus = "pending_approval"
	StatusSuspended UserStatus = "suspended"
)

type User struct {
	ID                      primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name                    string             `bson:"name" json:"name"`
	Email                   string             `bson:"email" json:"email"`
	Username                string             `bson:"username,omitempty" json:"username,omitempty"`
	PasswordHash            string             `bson:"password_hash" json:"-"`
	RefreshTokenHash        string             `bson:"refresh_token_hash,omitempty" json:"-"`
	Role                    Role               `bson:"role" json:"role"`
	StaffRole               string             `bson:"staff_role,omitempty" json:"staff_role,omitempty"`
	TeamID                  primitive.ObjectID `bson:"team_id,omitempty" json:"team_id,omitempty"`
	Status                  UserStatus         `bson:"status" json:"status"`
	AvatarURL               string             `bson:"avatar_url,omitempty" json:"avatar_url,omitempty"`
	ThemePreference         string             `bson:"theme_preference" json:"theme_preference"`
	TwoFactorEnabled        bool               `bson:"two_factor_enabled,omitempty" json:"two_factor_enabled"`
	TwoFactorSecret         string             `bson:"two_factor_secret,omitempty" json:"-"`
	EmailVerified           bool               `bson:"email_verified,omitempty" json:"email_verified"`
	EmailVerificationToken  string             `bson:"email_verification_token,omitempty" json:"-"`
	EmailVerificationSentAt *time.Time         `bson:"email_verification_sent_at,omitempty" json:"-"`
	AuthProvider            string             `bson:"auth_provider,omitempty" json:"auth_provider,omitempty"`
	RegistrationIP          string             `bson:"registration_ip,omitempty" json:"registration_ip,omitempty"`
	RegistrationCountry     string             `bson:"registration_country,omitempty" json:"registration_country,omitempty"`
	RegistrationCountryCode string             `bson:"registration_country_code,omitempty" json:"registration_country_code,omitempty"`
	RegistrationCity        string             `bson:"registration_city,omitempty" json:"registration_city,omitempty"`
	RegistrationNetworkName string             `bson:"registration_network_name,omitempty" json:"registration_network_name,omitempty"`
	RegistrationTimezone    string             `bson:"registration_timezone,omitempty" json:"registration_timezone,omitempty"`
	CreatedAt               time.Time          `bson:"created_at" json:"created_at"`
	LastActiveAt            time.Time          `bson:"last_active_at,omitempty" json:"last_active_at,omitempty"`
}

type Team struct {
	ID              primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	Name            string               `bson:"name" json:"name"`
	CompanyEmail    string               `bson:"company_email,omitempty" json:"company_email,omitempty"`
	LogoURL         string               `bson:"logo_url,omitempty" json:"logo_url,omitempty"`
	OwnerAdminID    primitive.ObjectID   `bson:"owner_admin_id" json:"owner_admin_id"`
	MemberIDs       []primitive.ObjectID `bson:"member_ids" json:"member_ids"`
	SubscriptionID  primitive.ObjectID   `bson:"subscription_id,omitempty" json:"subscription_id,omitempty"`
	CreatedAt       time.Time            `bson:"created_at" json:"created_at"`
	SeatLimitCached int                  `bson:"seat_limit_cached,omitempty" json:"seat_limit_cached,omitempty"`
}

type Subscription struct {
	ID                    primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID                primitive.ObjectID `bson:"team_id" json:"team_id"`
	PlanID                primitive.ObjectID `bson:"plan_id" json:"plan_id"`
	Status                string             `bson:"status" json:"status"`
	BillingPeriod         string             `bson:"billing_period,omitempty" json:"billing_period,omitempty"`
	BillingQuantity       int                `bson:"billing_quantity,omitempty" json:"billing_quantity,omitempty"`
	PaymentProvider       string             `bson:"payment_provider,omitempty" json:"payment_provider,omitempty"`
	ExternalTransactionID string             `bson:"external_transaction_id,omitempty" json:"external_transaction_id,omitempty"`
	BuyerID               primitive.ObjectID `bson:"buyer_id,omitempty" json:"buyer_id,omitempty"`
	TrialEndsAt           *time.Time         `bson:"trial_ends_at,omitempty" json:"trial_ends_at,omitempty"`
	ApprovedBy            primitive.ObjectID `bson:"approved_by,omitempty" json:"approved_by,omitempty"`
	StartedAt             time.Time          `bson:"started_at" json:"started_at"`
	ExpiresAt             *time.Time         `bson:"expires_at,omitempty" json:"expires_at,omitempty"`
	CreatedAt             time.Time          `bson:"created_at" json:"created_at"`
}

type Plan struct {
	ID                 primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name               string             `bson:"name" json:"name"`
	Description        string             `bson:"description" json:"description"`
	PricingModel       string             `bson:"pricing_model" json:"pricing_model"`
	Price              int64              `bson:"price" json:"price"`
	PriceYearly        int64              `bson:"price_yearly,omitempty" json:"price_yearly,omitempty"`
	PricePerSeat       int64              `bson:"price_per_seat,omitempty" json:"price_per_seat,omitempty"`
	PricePerSeatYearly int64              `bson:"price_per_seat_yearly,omitempty" json:"price_per_seat_yearly,omitempty"`
	TrialDays          int                `bson:"trial_days" json:"trial_days"`
	SeatLimit          int                `bson:"seat_limit" json:"seat_limit"`
	ProjectLimit       int                `bson:"project_limit" json:"project_limit"`
	StorageLimitMB     int                `bson:"storage_limit_mb" json:"storage_limit_mb"`
	Featured           bool               `bson:"featured,omitempty" json:"featured,omitempty"`
	CreatedAt          time.Time          `bson:"created_at" json:"created_at"`
}

type Invoice struct {
	ID                 primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID             primitive.ObjectID `bson:"team_id" json:"team_id"`
	SubscriptionID     primitive.ObjectID `bson:"subscription_id" json:"subscription_id"`
	Amount             int64              `bson:"amount" json:"amount"`
	Currency           string             `bson:"currency" json:"currency"`
	Status             string             `bson:"status" json:"status"`
	PaymentProvider    string             `bson:"payment_provider" json:"payment_provider"`
	ExternalInvoiceURL string             `bson:"external_invoice_url,omitempty" json:"external_invoice_url,omitempty"`
	IssuedAt           time.Time          `bson:"issued_at" json:"issued_at"`
}

type Space struct {
	ID         primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	TeamID     primitive.ObjectID   `bson:"team_id" json:"team_id"`
	Name       string               `bson:"name" json:"name"`
	ProjectIDs []primitive.ObjectID `bson:"project_ids" json:"project_ids"`
	CreatedAt  time.Time            `bson:"created_at" json:"created_at"`
}

type Project struct {
	ID        primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	SpaceID   primitive.ObjectID   `bson:"space_id" json:"space_id"`
	Name      string               `bson:"name" json:"name"`
	ListIDs   []primitive.ObjectID `bson:"list_ids" json:"list_ids"`
	CreatedAt time.Time            `bson:"created_at" json:"created_at"`
}

type ClientProject struct {
	ID             primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	TeamID         primitive.ObjectID   `bson:"team_id" json:"team_id"`
	Name           string               `bson:"name" json:"name"`
	CompanyEmail   string               `bson:"company_email,omitempty" json:"company_email,omitempty"`
	ContactName    string               `bson:"contact_name,omitempty" json:"contact_name,omitempty"`
	Details        string               `bson:"details,omitempty" json:"details,omitempty"`
	MemberIDs      []primitive.ObjectID `bson:"member_ids" json:"member_ids"`
	ClientAdminIDs []primitive.ObjectID `bson:"client_admin_ids" json:"client_admin_ids"`
	MemberRoles    map[string]string    `bson:"member_roles,omitempty" json:"member_roles,omitempty"`
	CreatedBy      primitive.ObjectID   `bson:"created_by" json:"created_by"`
	CreatedAt      time.Time            `bson:"created_at" json:"created_at"`
	UpdatedAt      time.Time            `bson:"updated_at" json:"updated_at"`
}

type ClientWebsite struct {
	ID             primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	ClientID       primitive.ObjectID   `bson:"client_id" json:"client_id"`
	TeamID         primitive.ObjectID   `bson:"team_id" json:"team_id"`
	Name           string               `bson:"name" json:"name"`
	URL            string               `bson:"url,omitempty" json:"url,omitempty"`
	Details        string               `bson:"details,omitempty" json:"details,omitempty"`
	WidgetKey      string               `bson:"widget_key,omitempty" json:"widget_key,omitempty"`
	MemberIDs      []primitive.ObjectID `bson:"member_ids,omitempty" json:"member_ids,omitempty"`
	ClientAdminIDs []primitive.ObjectID `bson:"client_admin_ids,omitempty" json:"client_admin_ids,omitempty"`
	MemberRoles    map[string]string    `bson:"member_roles,omitempty" json:"member_roles,omitempty"`
	CreatedBy      primitive.ObjectID   `bson:"created_by" json:"created_by"`
	CreatedAt      time.Time            `bson:"created_at" json:"created_at"`
	UpdatedAt      time.Time            `bson:"updated_at" json:"updated_at"`
}

type ClientDocument struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ClientID  primitive.ObjectID `bson:"client_id" json:"client_id"`
	WebsiteID primitive.ObjectID `bson:"website_id,omitempty" json:"website_id,omitempty"`
	TeamID    primitive.ObjectID `bson:"team_id" json:"team_id"`
	Title     string             `bson:"title" json:"title"`
	Kind      string             `bson:"kind" json:"kind"`
	Content   string             `bson:"content,omitempty" json:"content,omitempty"`
	URL       string             `bson:"url,omitempty" json:"url,omitempty"`
	FileURL   string             `bson:"file_url,omitempty" json:"file_url,omitempty"`
	CreatedBy primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time          `bson:"updated_at" json:"updated_at"`
}

type ClientTaskStatusStyle struct {
	IconColor string `bson:"icon_color,omitempty" json:"icon_color,omitempty"`
	TextColor string `bson:"text_color,omitempty" json:"text_color,omitempty"`
}

type ClientTab struct {
	ID           primitive.ObjectID               `bson:"_id,omitempty" json:"id"`
	ClientID     primitive.ObjectID               `bson:"client_id" json:"client_id"`
	WebsiteID    primitive.ObjectID               `bson:"website_id" json:"website_id"`
	TeamID       primitive.ObjectID               `bson:"team_id" json:"team_id"`
	Type         string                           `bson:"type" json:"type"`
	Title        string                           `bson:"title" json:"title"`
	Content      string                           `bson:"content,omitempty" json:"content,omitempty"`
	Statuses     []string                         `bson:"statuses,omitempty" json:"statuses,omitempty"`
	StatusStyles map[string]ClientTaskStatusStyle `bson:"status_styles,omitempty" json:"status_styles,omitempty"`
	CreatedBy    primitive.ObjectID               `bson:"created_by" json:"created_by"`
	CreatedAt    time.Time                        `bson:"created_at" json:"created_at"`
	UpdatedAt    time.Time                        `bson:"updated_at" json:"updated_at"`
}

type ClientTask struct {
	ID              primitive.ObjectID     `bson:"_id,omitempty" json:"id"`
	ClientID        primitive.ObjectID     `bson:"client_id" json:"client_id"`
	WebsiteID       primitive.ObjectID     `bson:"website_id" json:"website_id"`
	TabID           primitive.ObjectID     `bson:"tab_id" json:"tab_id"`
	TeamID          primitive.ObjectID     `bson:"team_id" json:"team_id"`
	Type            string                 `bson:"type" json:"type"`
	Title           string                 `bson:"title" json:"title"`
	Content         string                 `bson:"content,omitempty" json:"content,omitempty"`
	URL             string                 `bson:"url,omitempty" json:"url,omitempty"`
	Comment         string                 `bson:"comment,omitempty" json:"comment,omitempty"`
	ScreenshotURL   string                 `bson:"screenshot_url,omitempty" json:"screenshot_url,omitempty"`
	PinX            *float64               `bson:"pin_x,omitempty" json:"pin_x,omitempty"`
	PinY            *float64               `bson:"pin_y,omitempty" json:"pin_y,omitempty"`
	PageWidth       int                    `bson:"page_width,omitempty" json:"page_width,omitempty"`
	PageHeight      int                    `bson:"page_height,omitempty" json:"page_height,omitempty"`
	Annotations     []ClientTaskAnnotation `bson:"annotations,omitempty" json:"annotations,omitempty"`
	Attachments     []string               `bson:"attachments" json:"attachments"`
	Checklist       []ChecklistItem        `bson:"checklist,omitempty" json:"checklist,omitempty"`
	Blocks          []ClientTaskBlock      `bson:"blocks,omitempty" json:"blocks,omitempty"`
	AssigneeIDs     []primitive.ObjectID   `bson:"assignee_ids" json:"assignee_ids"`
	DueDate         *time.Time             `bson:"due_date,omitempty" json:"due_date,omitempty"`
	Recurrence      ClientTaskRecurrence   `bson:"recurrence,omitempty" json:"recurrence,omitempty"`
	Status          string                 `bson:"status" json:"status"`
	CompletionCount int                    `bson:"completion_count,omitempty" json:"completion_count,omitempty"`
	LastCompletedAt *time.Time             `bson:"last_completed_at,omitempty" json:"last_completed_at,omitempty"`
	CreatedBy       primitive.ObjectID     `bson:"created_by" json:"created_by"`
	CreatedAt       time.Time              `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time              `bson:"updated_at" json:"updated_at"`
}

type ClientTaskAnnotation struct {
	ID            primitive.ObjectID   `bson:"id,omitempty" json:"id"`
	Title         string               `bson:"title" json:"title"`
	URL           string               `bson:"url,omitempty" json:"url,omitempty"`
	Comment       string               `bson:"comment,omitempty" json:"comment,omitempty"`
	ScreenshotURL string               `bson:"screenshot_url,omitempty" json:"screenshot_url,omitempty"`
	PinX          *float64             `bson:"pin_x,omitempty" json:"pin_x,omitempty"`
	PinY          *float64             `bson:"pin_y,omitempty" json:"pin_y,omitempty"`
	PageWidth     int                  `bson:"page_width,omitempty" json:"page_width,omitempty"`
	PageHeight    int                  `bson:"page_height,omitempty" json:"page_height,omitempty"`
	Attachments   []string             `bson:"attachments,omitempty" json:"attachments,omitempty"`
	AssigneeIDs   []primitive.ObjectID `bson:"assignee_ids,omitempty" json:"assignee_ids,omitempty"`
	Status        string               `bson:"status,omitempty" json:"status,omitempty"`
	CreatedBy     primitive.ObjectID   `bson:"created_by,omitempty" json:"created_by,omitempty"`
	CreatedAt     time.Time            `bson:"created_at,omitempty" json:"created_at,omitempty"`
	UpdatedAt     time.Time            `bson:"updated_at,omitempty" json:"updated_at,omitempty"`
}

type ClientTaskBlock struct {
	Type      string          `bson:"type" json:"type"`
	Content   string          `bson:"content,omitempty" json:"content,omitempty"`
	Checklist []ChecklistItem `bson:"checklist,omitempty" json:"checklist,omitempty"`
}

type ClientTaskRecurrence struct {
	Frequency   string `bson:"frequency,omitempty" json:"frequency,omitempty"`
	MonthlyMode string `bson:"monthly_mode,omitempty" json:"monthly_mode,omitempty"`
	MonthDates  []int  `bson:"month_dates,omitempty" json:"month_dates,omitempty"`
	WeekOrdinal int    `bson:"week_ordinal,omitempty" json:"week_ordinal,omitempty"`
	Weekday     int    `bson:"weekday,omitempty" json:"weekday,omitempty"`
}

type ClientTaskCommentReaction struct {
	Emoji   string               `bson:"emoji" json:"emoji"`
	UserIDs []primitive.ObjectID `bson:"user_ids" json:"user_ids"`
}

type ClientTaskComment struct {
	ID             primitive.ObjectID          `bson:"_id,omitempty" json:"id"`
	TaskID         primitive.ObjectID          `bson:"task_id" json:"task_id"`
	ClientID       primitive.ObjectID          `bson:"client_id" json:"client_id"`
	WebsiteID      primitive.ObjectID          `bson:"website_id" json:"website_id"`
	TabID          primitive.ObjectID          `bson:"tab_id" json:"tab_id"`
	TeamID         primitive.ObjectID          `bson:"team_id" json:"team_id"`
	AuthorID       primitive.ObjectID          `bson:"author_id" json:"author_id"`
	Content        string                      `bson:"content" json:"content"`
	ReplyToID      primitive.ObjectID          `bson:"reply_to_id,omitempty" json:"reply_to_id,omitempty"`
	ReplyText      string                      `bson:"reply_text,omitempty" json:"reply_text,omitempty"`
	AttachmentURL  string                      `bson:"attachment_url,omitempty" json:"attachment_url,omitempty"`
	AttachmentName string                      `bson:"attachment_name,omitempty" json:"attachment_name,omitempty"`
	Reactions      []ClientTaskCommentReaction `bson:"reactions,omitempty" json:"reactions,omitempty"`
	ReadBy         []primitive.ObjectID        `bson:"read_by,omitempty" json:"read_by,omitempty"`
	CreatedAt      time.Time                   `bson:"created_at" json:"created_at"`
}

type ClientTaskLog struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TaskID    primitive.ObjectID `bson:"task_id" json:"task_id"`
	ClientID  primitive.ObjectID `bson:"client_id" json:"client_id"`
	WebsiteID primitive.ObjectID `bson:"website_id" json:"website_id"`
	TabID     primitive.ObjectID `bson:"tab_id" json:"tab_id"`
	TeamID    primitive.ObjectID `bson:"team_id" json:"team_id"`
	ActorID   primitive.ObjectID `bson:"actor_id" json:"actor_id"`
	Action    string             `bson:"action" json:"action"`
	Detail    string             `bson:"detail" json:"detail"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
}

type List struct {
	ID        primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	ProjectID primitive.ObjectID   `bson:"project_id" json:"project_id"`
	Name      string               `bson:"name" json:"name"`
	Statuses  []string             `bson:"statuses" json:"statuses"`
	TaskIDs   []primitive.ObjectID `bson:"task_ids" json:"task_ids"`
	CreatedAt time.Time            `bson:"created_at" json:"created_at"`
}

type ChecklistItem struct {
	Text string `bson:"text" json:"text"`
	Done bool   `bson:"done" json:"done"`
}

type Comment struct {
	ID             primitive.ObjectID   `bson:"id" json:"id"`
	AuthorID       primitive.ObjectID   `bson:"author_id" json:"author_id"`
	Content        string               `bson:"content" json:"content"`
	AttachmentURL  string               `bson:"attachment_url,omitempty" json:"attachment_url,omitempty"`
	AttachmentName string               `bson:"attachment_name,omitempty" json:"attachment_name,omitempty"`
	CreatedAt      time.Time            `bson:"created_at" json:"created_at"`
	ReadBy         []primitive.ObjectID `bson:"read_by,omitempty" json:"read_by,omitempty"`
}

type ExternalRef struct {
	Provider    string `bson:"provider,omitempty" json:"provider,omitempty"`
	ExternalID  string `bson:"external_id,omitempty" json:"external_id,omitempty"`
	ExternalURL string `bson:"external_url,omitempty" json:"external_url,omitempty"`
}

type Task struct {
	ID              primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	ListID          primitive.ObjectID   `bson:"list_id" json:"list_id"`
	Title           string               `bson:"title" json:"title"`
	Description     string               `bson:"description,omitempty" json:"description,omitempty"`
	Status          string               `bson:"status" json:"status"`
	Priority        string               `bson:"priority" json:"priority"`
	AssigneeIDs     []primitive.ObjectID `bson:"assignee_ids" json:"assignee_ids"`
	DueDate         *time.Time           `bson:"due_date,omitempty" json:"due_date,omitempty"`
	StartDate       *time.Time           `bson:"start_date,omitempty" json:"start_date,omitempty"`
	Tags            []string             `bson:"tags" json:"tags"`
	Checklist       []ChecklistItem      `bson:"checklist" json:"checklist"`
	Attachments     []string             `bson:"attachments" json:"attachments"`
	Comments        []Comment            `bson:"comments" json:"comments"`
	EstimateMinutes int                  `bson:"estimate_minutes,omitempty" json:"estimate_minutes,omitempty"`
	ExternalRef     ExternalRef          `bson:"external_ref,omitempty" json:"external_ref,omitempty"`
	CreatedBy       primitive.ObjectID   `bson:"created_by" json:"created_by"`
	CreatedAt       time.Time            `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time            `bson:"updated_at" json:"updated_at"`
}

type Website struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID        primitive.ObjectID `bson:"team_id" json:"team_id"`
	Name          string             `bson:"name" json:"name"`
	URL           string             `bson:"url" json:"url"`
	EmbedMode     string             `bson:"embed_mode" json:"embed_mode"`
	ScreenshotURL string             `bson:"screenshot_url,omitempty" json:"screenshot_url,omitempty"`
	CreatedBy     primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt     time.Time          `bson:"created_at" json:"created_at"`
}

type Bug struct {
	ID            primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	WebsiteID     primitive.ObjectID   `bson:"website_id" json:"website_id"`
	PinX          float64              `bson:"pin_x" json:"pin_x"`
	PinY          float64              `bson:"pin_y" json:"pin_y"`
	PageURL       string               `bson:"page_url" json:"page_url"`
	ScreenshotURL string               `bson:"screenshot_url,omitempty" json:"screenshot_url,omitempty"`
	Title         string               `bson:"title,omitempty" json:"title,omitempty"`
	Description   string               `bson:"description" json:"description"`
	Severity      string               `bson:"severity" json:"severity"`
	Status        string               `bson:"status" json:"status"`
	AssigneeID    primitive.ObjectID   `bson:"assignee_id,omitempty" json:"assignee_id,omitempty"`
	AssigneeIDs   []primitive.ObjectID `bson:"assignee_ids,omitempty" json:"assignee_ids,omitempty"`
	Attachments   []string             `bson:"attachments,omitempty" json:"attachments,omitempty"`
	LinkedTaskID  primitive.ObjectID   `bson:"linked_task_id,omitempty" json:"linked_task_id,omitempty"`
	Comments      []Comment            `bson:"comments" json:"comments"`
	CreatedBy     primitive.ObjectID   `bson:"created_by" json:"created_by"`
	CreatedAt     time.Time            `bson:"created_at" json:"created_at"`
}

type Chat struct {
	ID             primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	Type           string               `bson:"type" json:"type"`
	Title          string               `bson:"title,omitempty" json:"title,omitempty"`
	ParticipantIDs []primitive.ObjectID `bson:"participant_ids" json:"participant_ids"`
	TeamID         primitive.ObjectID   `bson:"team_id,omitempty" json:"team_id,omitempty"`
	Status         string               `bson:"status,omitempty" json:"status,omitempty"`
	EndedAt        *time.Time           `bson:"ended_at,omitempty" json:"ended_at,omitempty"`
	EndedBy        primitive.ObjectID   `bson:"ended_by,omitempty" json:"ended_by,omitempty"`
	CreatedBy      primitive.ObjectID   `bson:"created_by,omitempty" json:"created_by,omitempty"`
	DeletedAt      *time.Time           `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
	DeletedBy      primitive.ObjectID   `bson:"deleted_by,omitempty" json:"deleted_by,omitempty"`
	CreatedAt      time.Time            `bson:"created_at" json:"created_at"`
}

type Message struct {
	ID             primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	ChatID         primitive.ObjectID   `bson:"chat_id" json:"chat_id"`
	SenderID       primitive.ObjectID   `bson:"sender_id" json:"sender_id"`
	Content        string               `bson:"content" json:"content"`
	ReplyToID      primitive.ObjectID   `bson:"reply_to_id,omitempty" json:"reply_to_id,omitempty"`
	ReplyText      string               `bson:"reply_text,omitempty" json:"reply_text,omitempty"`
	AttachmentURL  string               `bson:"attachment_url,omitempty" json:"attachment_url,omitempty"`
	AttachmentName string               `bson:"attachment_name,omitempty" json:"attachment_name,omitempty"`
	SentAt         time.Time            `bson:"sent_at" json:"sent_at"`
	ReadBy         []primitive.ObjectID `bson:"read_by" json:"read_by"`
}

type Notification struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID    primitive.ObjectID `bson:"user_id" json:"user_id"`
	Type      string             `bson:"type" json:"type"`
	Content   string             `bson:"content" json:"content"`
	RelatedID primitive.ObjectID `bson:"related_id,omitempty" json:"related_id,omitempty"`
	Read      bool               `bson:"read" json:"read"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	DeletedAt *time.Time         `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
}

type PushDevice struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID     primitive.ObjectID `bson:"user_id" json:"user_id"`
	Token      string             `bson:"token" json:"token"`
	Platform   string             `bson:"platform" json:"platform"`
	Enabled    bool               `bson:"enabled" json:"enabled"`
	AppVersion string             `bson:"app_version,omitempty" json:"app_version,omitempty"`
	CreatedAt  time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt  time.Time          `bson:"updated_at" json:"updated_at"`
	LastSeenAt time.Time          `bson:"last_seen_at" json:"last_seen_at"`
}

type TeamInvitation struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID         primitive.ObjectID `bson:"team_id" json:"team_id"`
	Email          string             `bson:"email" json:"email"`
	Username       string             `bson:"username,omitempty" json:"username,omitempty"`
	StaffRole      string             `bson:"staff_role" json:"staff_role"`
	InvitedBy      primitive.ObjectID `bson:"invited_by" json:"invited_by"`
	ExistingUserID primitive.ObjectID `bson:"existing_user_id,omitempty" json:"existing_user_id,omitempty"`
	Token          string             `bson:"token" json:"-"`
	Status         string             `bson:"status" json:"status"`
	CreatedAt      time.Time          `bson:"created_at" json:"created_at"`
	ExpiresAt      time.Time          `bson:"expires_at" json:"expires_at"`
	RespondedAt    *time.Time         `bson:"responded_at,omitempty" json:"responded_at,omitempty"`
}

type EmailQueueItem struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Recipient string             `bson:"recipient" json:"recipient"`
	Type      string             `bson:"type" json:"type"`
	Subject   string             `bson:"subject" json:"subject"`
	BodyHTML  string             `bson:"body_html" json:"body_html"`
	Status    string             `bson:"status" json:"status"`
	SentAt    *time.Time         `bson:"sent_at,omitempty" json:"sent_at,omitempty"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	Error     string             `bson:"error,omitempty" json:"error,omitempty"`
}

type PasswordUpdateOTP struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID       primitive.ObjectID `bson:"user_id" json:"user_id"`
	Email        string             `bson:"email" json:"email"`
	Purpose      string             `bson:"purpose" json:"purpose"`
	CodeHash     string             `bson:"code_hash" json:"-"`
	AttemptCount int                `bson:"attempt_count,omitempty" json:"attempt_count,omitempty"`
	ExpiresAt    time.Time          `bson:"expires_at" json:"expires_at"`
	UsedAt       *time.Time         `bson:"used_at,omitempty" json:"used_at,omitempty"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
}

type AuditLog struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ActorID    primitive.ObjectID `bson:"actor_id" json:"actor_id"`
	Action     string             `bson:"action" json:"action"`
	TargetType string             `bson:"target_type" json:"target_type"`
	TargetID   primitive.ObjectID `bson:"target_id,omitempty" json:"target_id,omitempty"`
	Timestamp  time.Time          `bson:"timestamp" json:"timestamp"`
}

type SiteSettings struct {
	ID                      primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	SiteName                string             `bson:"site_name" json:"site_name"`
	CompanySlogan           string             `bson:"company_slogan,omitempty" json:"company_slogan,omitempty"`
	CompanyEmail            string             `bson:"company_email" json:"company_email"`
	OwnerName               string             `bson:"owner_name" json:"owner_name"`
	CompanyAddress          string             `bson:"company_address" json:"company_address"`
	CompanyContact          string             `bson:"company_contact,omitempty" json:"company_contact,omitempty"`
	LogoURL                 string             `bson:"logo_url,omitempty" json:"logo_url,omitempty"`
	FaviconURL              string             `bson:"favicon_url,omitempty" json:"favicon_url,omitempty"`
	SupportPhone            string             `bson:"support_phone,omitempty" json:"support_phone,omitempty"`
	TimeZone                string             `bson:"time_zone,omitempty" json:"time_zone,omitempty"`
	GoogleSigninEnabled     bool               `bson:"google_signin_enabled,omitempty" json:"google_signin_enabled"`
	GoogleClientID          string             `bson:"google_client_id,omitempty" json:"google_client_id,omitempty"`
	GoogleClientSecret      string             `bson:"google_client_secret,omitempty" json:"-"`
	GoogleRedirectURL       string             `bson:"google_redirect_url,omitempty" json:"google_redirect_url,omitempty"`
	SMTPEnabled             bool               `bson:"smtp_enabled,omitempty" json:"smtp_enabled"`
	SMTPHost                string             `bson:"smtp_host,omitempty" json:"smtp_host,omitempty"`
	SMTPPort                string             `bson:"smtp_port,omitempty" json:"smtp_port,omitempty"`
	SMTPUser                string             `bson:"smtp_user,omitempty" json:"smtp_user,omitempty"`
	SMTPPassword            string             `bson:"smtp_password,omitempty" json:"-"`
	SMTPFrom                string             `bson:"smtp_from,omitempty" json:"smtp_from,omitempty"`
	OwnerNotificationEmail  string             `bson:"owner_notification_email,omitempty" json:"owner_notification_email,omitempty"`
	OwnerNotifyRegistration bool               `bson:"owner_notify_registration,omitempty" json:"owner_notify_registration"`
	OwnerNotifyPurchase     bool               `bson:"owner_notify_purchase,omitempty" json:"owner_notify_purchase"`
	OwnerNotifyNewChat      bool               `bson:"owner_notify_new_chat,omitempty" json:"owner_notify_new_chat"`
	OwnerNotificationsSet   bool               `bson:"owner_notifications_set,omitempty" json:"owner_notifications_set"`
	StripeEnabled           bool               `bson:"stripe_enabled,omitempty" json:"stripe_enabled"`
	StripePublishableKey    string             `bson:"stripe_publishable_key,omitempty" json:"stripe_publishable_key,omitempty"`
	StripeSecretKey         string             `bson:"stripe_secret_key,omitempty" json:"-"`
	StripeWebhookSecret     string             `bson:"stripe_webhook_secret,omitempty" json:"-"`
	PayPalEnabled           bool               `bson:"paypal_enabled,omitempty" json:"paypal_enabled"`
	PayPalMode              string             `bson:"paypal_mode,omitempty" json:"paypal_mode,omitempty"`
	PayPalClientID          string             `bson:"paypal_client_id,omitempty" json:"paypal_client_id,omitempty"`
	PayPalClientSecret      string             `bson:"paypal_client_secret,omitempty" json:"-"`
	PayPalWebhookID         string             `bson:"paypal_webhook_id,omitempty" json:"paypal_webhook_id,omitempty"`
	ThemePrimaryColor       string             `bson:"theme_primary_color,omitempty" json:"theme_primary_color,omitempty"`
	ThemePrimaryStrongColor string             `bson:"theme_primary_strong_color,omitempty" json:"theme_primary_strong_color,omitempty"`
	ThemeButtonColor        string             `bson:"theme_button_color,omitempty" json:"theme_button_color,omitempty"`
	ThemeButtonTextColor    string             `bson:"theme_button_text_color,omitempty" json:"theme_button_text_color,omitempty"`
	ThemeFontColor          string             `bson:"theme_font_color,omitempty" json:"theme_font_color,omitempty"`
	ThemeHeadingColor       string             `bson:"theme_heading_color,omitempty" json:"theme_heading_color,omitempty"`
	ThemeBackgroundColor    string             `bson:"theme_background_color,omitempty" json:"theme_background_color,omitempty"`
	PublicNavLogoURL        string             `bson:"public_nav_logo_url,omitempty" json:"public_nav_logo_url,omitempty"`
	PublicNavCompanyName    string             `bson:"public_nav_company_name,omitempty" json:"public_nav_company_name,omitempty"`
	PublicNavButtonText     string             `bson:"public_nav_button_text,omitempty" json:"public_nav_button_text,omitempty"`
	PublicNavButtonURL      string             `bson:"public_nav_button_url,omitempty" json:"public_nav_button_url,omitempty"`
	PublicNavButtonStyle    string             `bson:"public_nav_button_style,omitempty" json:"public_nav_button_style,omitempty"`
	PublicNavItems          []PublicNavItem    `bson:"public_nav_items,omitempty" json:"public_nav_items,omitempty"`
	SocialLinks             []SocialLink       `bson:"social_links,omitempty" json:"social_links,omitempty"`
	UpdatedAt               time.Time          `bson:"updated_at" json:"updated_at"`
}

type SocialLink struct {
	ID      string `bson:"id" json:"id"`
	Label   string `bson:"label" json:"label"`
	Icon    string `bson:"icon" json:"icon"`
	URL     string `bson:"url" json:"url"`
	Visible bool   `bson:"visible" json:"visible"`
	Order   int    `bson:"order" json:"order"`
}

type PublicNavItem struct {
	ID      string `bson:"id" json:"id"`
	Label   string `bson:"label" json:"label"`
	URL     string `bson:"url" json:"url"`
	Visible bool   `bson:"visible" json:"visible"`
	Order   int    `bson:"order" json:"order"`
}

type PageBlock struct {
	ID       string                 `bson:"id" json:"id"`
	Type     string                 `bson:"type" json:"type"`
	Props    map[string]interface{} `bson:"props" json:"props"`
	Children []PageBlock            `bson:"children" json:"children"`
}

type PageVersion struct {
	ID        primitive.ObjectID `bson:"id" json:"id"`
	PageWidth string             `bson:"page_width,omitempty" json:"page_width,omitempty"`
	Blocks    []PageBlock        `bson:"blocks" json:"blocks"`
	HTML      string             `bson:"html" json:"html"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	CreatedBy primitive.ObjectID `bson:"created_by,omitempty" json:"created_by,omitempty"`
}

type StaticPage struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Slug              string             `bson:"slug" json:"slug"`
	Title             string             `bson:"title" json:"title"`
	PageWidth         string             `bson:"page_width,omitempty" json:"page_width,omitempty"`
	Blocks            []PageBlock        `bson:"blocks" json:"blocks"`
	Status            string             `bson:"status" json:"status"`
	RenderedHTMLCache string             `bson:"rendered_html_cache" json:"rendered_html_cache"`
	CacheExpiresAt    *time.Time         `bson:"cache_expires_at,omitempty" json:"cache_expires_at,omitempty"`
	Versions          []PageVersion      `bson:"versions" json:"versions"`
	UpdatedBy         primitive.ObjectID `bson:"updated_by,omitempty" json:"updated_by,omitempty"`
	UpdatedAt         time.Time          `bson:"updated_at" json:"updated_at"`
}

type Integration struct {
	ID                   primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID               primitive.ObjectID `bson:"team_id" json:"team_id"`
	Provider             string             `bson:"provider" json:"provider"`
	AuthType             string             `bson:"auth_type" json:"auth_type"`
	CredentialsEncrypted string             `bson:"credentials_encrypted" json:"-"`
	ConnectedBy          primitive.ObjectID `bson:"connected_by" json:"connected_by"`
	ConnectedAt          time.Time          `bson:"connected_at" json:"connected_at"`
	Status               string             `bson:"status" json:"status"`
}

type ImportJob struct {
	ID                primitive.ObjectID     `bson:"_id,omitempty" json:"id"`
	TeamID            primitive.ObjectID     `bson:"team_id" json:"team_id"`
	Provider          string                 `bson:"provider" json:"provider"`
	ExternalProjectID string                 `bson:"external_project_id" json:"external_project_id"`
	TargetListID      primitive.ObjectID     `bson:"target_list_id" json:"target_list_id"`
	FieldMapping      map[string]interface{} `bson:"field_mapping" json:"field_mapping"`
	Status            string                 `bson:"status" json:"status"`
	Total             int                    `bson:"total" json:"total"`
	ImportedCount     int                    `bson:"imported_count" json:"imported_count"`
	SkippedCount      int                    `bson:"skipped_count" json:"skipped_count"`
	Errors            []string               `bson:"errors" json:"errors"`
	CreatedBy         primitive.ObjectID     `bson:"created_by" json:"created_by"`
	CreatedAt         time.Time              `bson:"created_at" json:"created_at"`
}

type ExportJob struct {
	ID                primitive.ObjectID     `bson:"_id,omitempty" json:"id"`
	TeamID            primitive.ObjectID     `bson:"team_id" json:"team_id"`
	Provider          string                 `bson:"provider" json:"provider"`
	TaskIDs           []primitive.ObjectID   `bson:"task_ids" json:"task_ids"`
	ExternalProjectID string                 `bson:"external_project_id" json:"external_project_id"`
	FieldMapping      map[string]interface{} `bson:"field_mapping" json:"field_mapping"`
	Status            string                 `bson:"status" json:"status"`
	ExportedCount     int                    `bson:"exported_count" json:"exported_count"`
	Errors            []string               `bson:"errors" json:"errors"`
	CreatedBy         primitive.ObjectID     `bson:"created_by" json:"created_by"`
	CreatedAt         time.Time              `bson:"created_at" json:"created_at"`
}

type TimeEntry struct {
	ID              primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TaskID          primitive.ObjectID `bson:"task_id" json:"task_id"`
	UserID          primitive.ObjectID `bson:"user_id" json:"user_id"`
	TeamID          primitive.ObjectID `bson:"team_id" json:"team_id"`
	StartTime       time.Time          `bson:"start_time" json:"start_time"`
	EndTime         *time.Time         `bson:"end_time,omitempty" json:"end_time,omitempty"`
	DurationMinutes int                `bson:"duration_minutes" json:"duration_minutes"`
	IsManual        bool               `bson:"is_manual" json:"is_manual"`
	Note            string             `bson:"note,omitempty" json:"note,omitempty"`
	Billable        bool               `bson:"billable" json:"billable"`
	CreatedAt       time.Time          `bson:"created_at" json:"created_at"`
}
