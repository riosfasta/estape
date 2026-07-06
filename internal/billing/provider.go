package billing

import (
	"context"
	"fmt"
	"time"
)

type CheckoutRequest struct {
	TeamID   string
	PlanID   string
	Amount   int64
	Currency string
}

type CheckoutSession struct {
	Provider   string `json:"provider"`
	ExternalID string `json:"external_id"`
	URL        string `json:"url"`
	Status     string `json:"status"`
}

type PaymentProvider interface {
	Name() string
	CreateCheckout(context.Context, CheckoutRequest) (CheckoutSession, error)
	HandleWebhook(context.Context, []byte, map[string]string) (string, error)
	RefundPayment(context.Context, string) error
}

type MockProvider struct {
	provider string
	baseURL  string
}

func NewStripeProvider(baseURL string) PaymentProvider {
	return MockProvider{provider: "stripe", baseURL: baseURL}
}

func NewPayPalProvider(baseURL string) PaymentProvider {
	return MockProvider{provider: "paypal", baseURL: baseURL}
}

func (p MockProvider) Name() string {
	return p.provider
}

func (p MockProvider) CreateCheckout(_ context.Context, req CheckoutRequest) (CheckoutSession, error) {
	externalID := fmt.Sprintf("%s_%d", p.provider, time.Now().UnixNano())
	return CheckoutSession{
		Provider:   p.provider,
		ExternalID: externalID,
		URL:        fmt.Sprintf("%s/settings/billing?checkout=%s", p.baseURL, externalID),
		Status:     "created",
	}, nil
}

func (p MockProvider) HandleWebhook(_ context.Context, _ []byte, _ map[string]string) (string, error) {
	return "payment_succeeded", nil
}

func (p MockProvider) RefundPayment(_ context.Context, _ string) error {
	return nil
}
