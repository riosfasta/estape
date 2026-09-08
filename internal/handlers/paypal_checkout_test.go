package handlers

import (
	"context"
	"testing"

	"bugmark/internal/billing"
	"bugmark/internal/models"
)

func TestSubscriptionCaptureUsesCheckoutQuote(t *testing.T) {
	sub := models.Subscription{ExternalTransactionID: "order-1", CheckoutAmount: 12500}
	capture := billing.PaymentCapture{ExternalID: "order-1", CaptureID: "capture-1", Status: "COMPLETED", Amount: 12500, Currency: "USD"}
	amount, err := validateSubscriptionCapture(sub, capture, 20000)
	if err != nil || amount != 12500 {
		t.Fatalf("price change must not alter checkout quote: %d %v", amount, err)
	}
	sub.CheckoutAmount = 0
	if _, err := validateSubscriptionCapture(sub, capture, 12500); err != nil {
		t.Fatalf("legacy checkout should still validate: %v", err)
	}
}

func TestSubscriptionCaptureRejectsUnverifiedPayments(t *testing.T) {
	sub := models.Subscription{ExternalTransactionID: "order-1", CheckoutAmount: 12500}
	valid := billing.PaymentCapture{ExternalID: "order-1", CaptureID: "capture-1", Status: "COMPLETED", Amount: 12500, Currency: "USD"}
	for name, alter := range map[string]func(*billing.PaymentCapture){
		"other order":      func(c *billing.PaymentCapture) { c.ExternalID = "other" },
		"wrong amount":     func(c *billing.PaymentCapture) { c.Amount = 1 },
		"wrong currency":   func(c *billing.PaymentCapture) { c.Currency = "EUR" },
		"missing currency": func(c *billing.PaymentCapture) { c.Currency = "" },
		"pending":          func(c *billing.PaymentCapture) { c.Status = "PENDING" },
		"missing capture":  func(c *billing.PaymentCapture) { c.CaptureID = "" },
	} {
		t.Run(name, func(t *testing.T) {
			capture := valid
			alter(&capture)
			if _, err := validateSubscriptionCapture(sub, capture, 12500); err == nil {
				t.Fatal("accepted an unverified payment")
			}
		})
	}
}

func TestProcessPayPalRiskWebhookEvents(t *testing.T) {
	s := &Server{}
	ctx := context.Background()

	tests := []struct {
		name      string
		payload   string
		wantEvent string
	}{
		{
			name:      "dispute created",
			payload:   `{"event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"dispute_id":"PP-D-123","reason":"UNAUTHORISED","dispute_amount":{"value":"99.00","currency_code":"USD"},"disputed_transactions":[{"seller_transaction_id":"cap-123"}]}}`,
			wantEvent: "dispute_created",
		},
		{
			name:      "dispute resolved",
			payload:   `{"event_type":"CUSTOMER.DISPUTE.RESOLVED","resource":{"dispute_id":"PP-D-123","status":"RESOLVED","dispute_outcome":{"outcome_code":"RESOLVED_BUYER_FAVOUR"}}}`,
			wantEvent: "dispute_resolved",
		},
		{
			name:      "capture pending risk review",
			payload:   `{"event_type":"PAYMENT.CAPTURE.PENDING","resource":{"id":"cap-pending-1","status_details":{"reason":"risk_review"}}}`,
			wantEvent: "capture_pending",
		},
		{
			name:      "capture denied",
			payload:   `{"event_type":"PAYMENT.CAPTURE.DENIED","resource":{"id":"cap-denied-1"}}`,
			wantEvent: "capture_denied",
		},
		{
			name:      "capture reversed",
			payload:   `{"event_type":"PAYMENT.CAPTURE.REVERSED","resource":{"id":"cap-rev-1"}}`,
			wantEvent: "capture_reversed",
		},
		{
			name:      "capture completed seller protection risk",
			payload:   `{"event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"cap-ok-1","seller_protection":{"status":"NOT_ELIGIBLE"}}}`,
			wantEvent: "capture_completed",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			event, err := s.processPayPalRiskWebhook(ctx, []byte(tc.payload))
			if err != nil {
				t.Fatalf("unexpected error processing webhook: %v", err)
			}
			if event != tc.wantEvent {
				t.Fatalf("got event %q, want %q", event, tc.wantEvent)
			}
		})
	}
}
