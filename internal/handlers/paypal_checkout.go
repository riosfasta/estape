package handlers

import (
	"errors"
	"net/http"
	"strings"

	"bugmark/internal/billing"
	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

func validateSubscriptionCapture(sub models.Subscription, capture billing.PaymentCapture, currentPrice int64) (int64, error) {
	amount := currentPrice
	if sub.CheckoutAmount > 0 {
		amount = sub.CheckoutAmount
	}
	if !strings.EqualFold(capture.Status, "COMPLETED") || strings.TrimSpace(capture.CaptureID) == "" ||
		strings.TrimSpace(sub.ExternalTransactionID) == "" || capture.ExternalID != sub.ExternalTransactionID ||
		amount <= 0 || capture.Amount != amount || !strings.EqualFold(capture.Currency, "USD") {
		return 0, errors.New("paypal capture does not match checkout")
	}
	return amount, nil
}

// Only the public SDK identifier is sent to the browser. Credentials remain server-side.
func (s *Server) payPalSDKConfig(c *gin.Context) {
	base, err := s.payPalCheckoutBase(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "PayPal checkout is unavailable. Contact the platform owner."})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"client_id": base.ClientID, "currency": "USD", "mode": base.Mode})
}

func (s *Server) capturePayPalSubscription(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var sub models.Subscription
	if err := s.store.C("subscriptions").FindOne(ctx, bson.M{"_id": id, "team_id": user.TeamID, "buyer_id": user.ID, "payment_provider": "paypal"}).Decode(&sub); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Checkout not found"})
		return
	}
	if invoice, paid := s.paidInvoiceForSubscription(ctx, sub.ID); paid {
		c.JSON(http.StatusOK, gin.H{"ok": true, "invoice": invoice})
		return
	}
	if sub.Status != "pending_payment" || strings.TrimSpace(sub.ExternalTransactionID) == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "Checkout is not ready for payment"})
		return
	}
	base, err := s.payPalCheckoutBase(ctx)
	provider := s.payments["paypal"]
	if err != nil || provider == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "PayPal checkout is unavailable"})
		return
	}
	// The stored order, price and buyer are authoritative, never browser-supplied values.
	capture, err := provider.CaptureCheckout(ctx, base, sub.ExternalTransactionID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Payment confirmation is pending. Retry confirmation for this checkout."})
		return
	}
	invoice, err := s.activatePaidPayPalSubscription(ctx, sub, capture)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Payment could not be verified. Retry confirmation for this checkout."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "invoice": invoice})
}
