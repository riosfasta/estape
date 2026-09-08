package models

import (
	"go.mongodb.org/mongo-driver/bson/primitive"
	"time"
)

type FreelancerProfile struct {
	PortfolioDetails []PortfolioDetail  `bson:"portfolio_details,omitempty" json:"portfolio_details"`
	Availability     string             `bson:"availability,omitempty" json:"availability"`
	PortfolioPhotos  []string           `bson:"portfolio_photos,omitempty" json:"portfolio_photos"`
	YouTubeURLs      []string           `bson:"youtube_urls,omitempty" json:"youtube_urls"`
	ID               primitive.ObjectID `bson:"_id" json:"id"`
	Name             string             `bson:"name" json:"name"`
	Title            string             `bson:"title" json:"title"`
	Bio              string             `bson:"bio" json:"bio"`
	Country          string             `bson:"country" json:"country"`
	Location         string             `bson:"location" json:"location"`
	Skills           []string           `bson:"skills" json:"skills"`
	Photo            string             `bson:"photo" json:"photo"`
	Public           bool               `bson:"public" json:"public"`
	ConsentVersion   string             `bson:"consent_version" json:"consent_version"`
	ConsentAt        time.Time          `bson:"consent_at" json:"consent_at"`
	IdentityStatus   string             `bson:"identity_status" json:"identity_status"`
	IdentityRevision primitive.ObjectID `bson:"identity_revision,omitempty" json:"identity_revision,omitempty"`
	ActiveJobs       int                `bson:"active_jobs" json:"active_jobs"`
	FinishedJobs     int                `bson:"finished_jobs" json:"finished_jobs"`
	PublishedJobs    int                `bson:"published_jobs" json:"published_jobs"`
	Rating           float64            `bson:"rating" json:"rating"`
	RatingTotal      int                `bson:"rating_total" json:"-"`
	RatingCount      int                `bson:"rating_count" json:"rating_count"`
	Connects         int                `bson:"connects" json:"connects"`
	ConnectWeek      time.Time          `bson:"connect_week" json:"connect_week"`
	UpdatedAt        time.Time          `bson:"updated_at" json:"updated_at"`
}

type PortfolioDetail struct {
	Photo       string `bson:"photo" json:"photo"`
	Title       string `bson:"title,omitempty" json:"title"`
	URL         string `bson:"url,omitempty" json:"url"`
	Description string `bson:"description,omitempty" json:"description"`
}

type MarketplaceJob struct {
	BillingType    string                 `bson:"billing_type,omitempty" json:"billing_type,omitempty"`
	HourlyRate     int64                  `bson:"hourly_rate,omitempty" json:"hourly_rate,omitempty"`
	MaxSeconds     int64                  `bson:"max_seconds,omitempty" json:"max_seconds,omitempty"`
	TrackedSeconds int64                  `bson:"tracked_seconds,omitempty" json:"tracked_seconds,omitempty"`
	TimerStartedAt *time.Time             `bson:"timer_started_at,omitempty" json:"-"`
	TimerUntil     *time.Time             `bson:"timer_until,omitempty" json:"-"`
	TimerTaskID    primitive.ObjectID     `bson:"timer_task_id,omitempty" json:"-"`
	ScopeTasks     []MarketplaceScopeTask `bson:"scope_tasks,omitempty" json:"-"`
	ScopeWebsiteID primitive.ObjectID     `bson:"scope_website_id,omitempty" json:"-"`
	ScopePriceMode string                 `bson:"scope_price_mode,omitempty" json:"scope_price_mode,omitempty"`
	SourceTaskID   primitive.ObjectID     `bson:"source_task_id,omitempty" json:"-"`
	ID             primitive.ObjectID     `bson:"_id" json:"id"`
	OwnerID        primitive.ObjectID     `bson:"owner_id" json:"owner_id"`
	OwnerName      string                 `bson:"owner_name" json:"owner_name"`
	FreelancerID   primitive.ObjectID     `bson:"freelancer_id,omitempty" json:"freelancer_id"`
	Title          string                 `bson:"title" json:"title"`
	Description    string                 `bson:"description" json:"description"`
	Skills         []string               `bson:"skills" json:"skills"`
	Budget         int64                  `bson:"budget" json:"budget"`
	Price          int64                  `bson:"price" json:"price"`
	Fee            int64                  `bson:"fee" json:"fee"`
	Status         string                 `bson:"status" json:"status"`
	Delivery       string                 `bson:"delivery,omitempty" json:"delivery,omitempty"`
	Rating         int                    `bson:"rating" json:"rating"`
	Review         string                 `bson:"review" json:"review"`
	CreatedAt      time.Time              `bson:"created_at" json:"created_at"`
	ApprovedAt     *time.Time             `bson:"approved_at,omitempty" json:"approved_at,omitempty"`
	AvailableAt    *time.Time             `bson:"available_at,omitempty" json:"available_at,omitempty"`
}

type MarketplaceScopeTask struct {
	TaskID  primitive.ObjectID `bson:"task_id" json:"task_id"`
	Title   string             `bson:"title" json:"title"`
	Content string             `bson:"content" json:"content"`
	Status  string             `bson:"status" json:"status"`
	Price   int64              `bson:"price" json:"price"`
}

type MarketplaceChatMessage struct {
	ID           primitive.ObjectID `bson:"_id" json:"id"`
	JobID        primitive.ObjectID `bson:"job_id" json:"job_id"`
	FreelancerID primitive.ObjectID `bson:"freelancer_id" json:"freelancer_id"`
	SenderID     primitive.ObjectID `bson:"sender_id" json:"sender_id"`
	Content      string             `bson:"content" json:"content"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
}

type MarketplaceProposal struct {
	ID           primitive.ObjectID `bson:"_id" json:"id"`
	JobID        primitive.ObjectID `bson:"job_id" json:"job_id"`
	FreelancerID primitive.ObjectID `bson:"freelancer_id" json:"freelancer_id"`
	Name         string             `bson:"name" json:"name"`
	Price        int64              `bson:"price" json:"price"`
	Message      string             `bson:"message" json:"message"`
	Kind         string             `bson:"kind" json:"kind"`
	Status       string             `bson:"status" json:"status"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
}

// Deposits and matured earnings are separate so refunds cannot spend earnings.
type MarketplaceWallet struct {
	ID       primitive.ObjectID `bson:"_id" json:"id"`
	Deposits int64              `bson:"deposits" json:"deposits"`
	Earnings int64              `bson:"earnings" json:"earnings"`
	Reserved int64              `bson:"reserved" json:"reserved"`
	Pending  int64              `bson:"pending" json:"pending"`
}

type MarketplaceTransfer struct {
	PaymentReference       string             `bson:"payment_reference,omitempty" json:"payment_reference,omitempty"`
	ID                     primitive.ObjectID `bson:"_id" json:"id"`
	UserID                 primitive.ObjectID `bson:"user_id" json:"user_id"`
	Kind                   string             `bson:"kind" json:"kind"`
	Amount                 int64              `bson:"amount" json:"amount"`
	Fee                    int64              `bson:"fee" json:"fee"`
	Status                 string             `bson:"status" json:"status"`
	ExternalID             string             `bson:"external_id,omitempty" json:"external_id,omitempty"`
	CaptureID              string             `bson:"capture_id,omitempty" json:"capture_id,omitempty"`
	SellerProtectionStatus string             `bson:"seller_protection_status,omitempty" json:"seller_protection_status,omitempty"`
	RiskWarning            string             `bson:"risk_warning,omitempty" json:"risk_warning,omitempty"`
	DisputeStatus          string             `bson:"dispute_status,omitempty" json:"dispute_status,omitempty"`
	Destination            string             `bson:"destination,omitempty" json:"destination,omitempty"`
	CreatedAt              time.Time          `bson:"created_at" json:"created_at"`
}
