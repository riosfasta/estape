package billing

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

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
