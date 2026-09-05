package billing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPayPalCheckoutSendsReconciliationReference(t *testing.T) {
	ref := "BM-TOPUP-000000000000000000000001-000000000000000000000002"
	created := false
	provider := PayPalProvider{client: &http.Client{Transport: paypalTestTransport(func(req *http.Request) (*http.Response, error) {
		body := `{"access_token":"test-token"}`
		if req.URL.Path == "/v2/checkout/orders" {
			created = true
			var payload struct {
				Units []struct {
					CustomID    string `json:"custom_id"`
					InvoiceID   string `json:"invoice_id"`
					Description string `json:"description"`
				} `json:"purchase_units"`
			}
			if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if len(payload.Units) != 1 || payload.Units[0].CustomID != ref || payload.Units[0].InvoiceID != ref || !strings.HasPrefix(payload.Units[0].Description, ref) {
				t.Fatalf("missing payment reference: %+v", payload)
			}
			if len(payload.Units[0].Description) > 127 {
				t.Fatal("description exceeds PayPal limit")
			}
			body = `{"id":"test-order","status":"CREATED","links":[{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=test-order"}]}`
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
	_, err := provider.CreateCheckout(context.Background(), CheckoutRequest{
		ClientID: "test", ClientSecret: "test", Amount: 1000, Currency: "USD",
		ReturnURL: "https://bugmega.test/return", CancelURL: "https://bugmega.test/cancel",
		CustomID: ref, InvoiceID: ref, Description: ref + " | " + strings.Repeat("Long plan name ", 20),
	})
	if err != nil || !created {
		t.Fatalf("checkout failed: %v", err)
	}
}

type paypalTestTransport func(*http.Request) (*http.Response, error)

func (fn paypalTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

func TestPayPalCaptureRetryReadsCompletedOrder(t *testing.T) {
	for _, completed := range []bool{true, false} {
		name := "pending"
		if completed {
			name = "completed"
		}
		t.Run(name, func(t *testing.T) {
			lookup := false
			provider := PayPalProvider{client: &http.Client{Transport: paypalTestTransport(func(req *http.Request) (*http.Response, error) {
				code := 200
				body := `{"access_token":"test-token"}`
				if strings.HasSuffix(req.URL.Path, "/capture") {
					code = 422
					body = `{"name":"UNPROCESSABLE_ENTITY"}`
				} else if req.Method == http.MethodGet {
					lookup = true
					body = `{"id":"order-1","status":"APPROVED"}`
					if completed {
						body = `{"id":"order-1","status":"COMPLETED","purchase_units":[{"payments":{"captures":[{"id":"capture-1","status":"COMPLETED","amount":{"currency_code":"USD","value":"100.00"}}]}}]}`
					}
				}
				return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}}
			capture, err := provider.CaptureCheckout(context.Background(), CheckoutRequest{ClientID: "test", ClientSecret: "test"}, "order-1")
			if !lookup {
				t.Fatal("retry did not look up existing order")
			}
			if completed && (err != nil || capture.Amount != 10000 || capture.CaptureID != "capture-1") {
				t.Fatalf("capture retry failed: %+v %v", capture, err)
			}
			if !completed && err == nil {
				t.Fatal("uncompleted order accepted")
			}
		})
	}
}

func TestUnimplementedPayPalRefundNeverReportsSuccess(t *testing.T) {
	if err := (PayPalProvider{}).RefundPayment(context.Background(), "capture"); err == nil {
		t.Fatal("no-op refund reported success")
	}
}
