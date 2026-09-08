package handlers

import (
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
