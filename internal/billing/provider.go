package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type CheckoutRequest struct {
	TeamID       string
	PlanID       string
	Amount       int64
	Currency     string
	ClientID     string
	ClientSecret string
	Mode         string
	ReturnURL    string
	CancelURL    string
	Description  string
	CustomID     string
	InvoiceID    string
	BrandName    string
}

type CheckoutSession struct {
	Provider   string `json:"provider"`
	ExternalID string `json:"external_id"`
	URL        string `json:"url"`
	Status     string `json:"status"`
}

type PaymentCapture struct {
	Provider    string `json:"provider"`
	ExternalID  string `json:"external_id"`
	CaptureID   string `json:"capture_id,omitempty"`
	Status      string `json:"status"`
	OrderStatus string `json:"order_status,omitempty"`
	Amount      int64  `json:"amount,omitempty"`
	Currency    string `json:"currency,omitempty"`
	PayerEmail  string `json:"payer_email,omitempty"`
}

type PaymentProvider interface {
	Name() string
	CreateCheckout(context.Context, CheckoutRequest) (CheckoutSession, error)
	CaptureCheckout(context.Context, CheckoutRequest, string) (PaymentCapture, error)
	HandleWebhook(context.Context, []byte, map[string]string) (string, error)
	RefundPayment(context.Context, string) error
}

type MockProvider struct {
	provider string
	baseURL  string
}

type PayPalProvider struct {
	baseURL string
	client  *http.Client
}

func NewStripeProvider(baseURL string) PaymentProvider {
	return MockProvider{provider: "stripe", baseURL: baseURL}
}

func NewPayPalProvider(baseURL string) PaymentProvider {
	return PayPalProvider{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 25 * time.Second},
	}
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

func (p MockProvider) CaptureCheckout(_ context.Context, _ CheckoutRequest, orderID string) (PaymentCapture, error) {
	return PaymentCapture{Provider: p.provider, ExternalID: orderID, Status: "COMPLETED"}, nil
}

func (p MockProvider) HandleWebhook(_ context.Context, _ []byte, _ map[string]string) (string, error) {
	return "payment_succeeded", nil
}

func (p MockProvider) RefundPayment(_ context.Context, _ string) error {
	return nil
}

func (p PayPalProvider) Name() string {
	return "paypal"
}

func (p PayPalProvider) CreateCheckout(ctx context.Context, req CheckoutRequest) (CheckoutSession, error) {
	if err := validatePayPalCheckout(req); err != nil {
		return CheckoutSession{}, err
	}
	token, apiBase, err := p.accessToken(ctx, req)
	if err != nil {
		return CheckoutSession{}, err
	}

	currency := normalizedCurrency(req.Currency)
	applicationContext := map[string]string{
		"return_url":          req.ReturnURL,
		"cancel_url":          req.CancelURL,
		"user_action":         "PAY_NOW",
		"shipping_preference": "NO_SHIPPING",
	}
	if brand := strings.TrimSpace(req.BrandName); brand != "" {
		applicationContext["brand_name"] = trimPayPalField(brand, 127)
	}
	payload := map[string]interface{}{
		"intent": "CAPTURE",
		"purchase_units": []map[string]interface{}{
			{
				"reference_id": trimPayPalField(firstNonEmpty(req.TeamID, req.CustomID), 256),
				"custom_id":    trimPayPalField(firstNonEmpty(req.CustomID, req.TeamID), 127),
				"description":  trimPayPalField(firstNonEmpty(req.Description, "BugMega subscription"), 127),
				"invoice_id":   trimPayPalField(req.InvoiceID, 127),
				"amount": map[string]string{
					"currency_code": currency,
					"value":         amountCentsForPayPal(req.Amount),
				},
			},
		},
		"application_context": applicationContext,
	}

	var response struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Links  []struct {
			Href string `json:"href"`
			Rel  string `json:"rel"`
		} `json:"links"`
	}
	if err := p.postJSON(ctx, apiBase+"/v2/checkout/orders", token, requestID("paypal-create", req.CustomID), payload, &response); err != nil {
		return CheckoutSession{}, err
	}
	approveURL := ""
	for _, link := range response.Links {
		if strings.EqualFold(link.Rel, "approve") {
			approveURL = link.Href
			break
		}
	}
	if strings.TrimSpace(response.ID) == "" || strings.TrimSpace(approveURL) == "" {
		return CheckoutSession{}, errors.New("paypal did not return an approval url")
	}
	return CheckoutSession{
		Provider:   p.Name(),
		ExternalID: response.ID,
		URL:        approveURL,
		Status:     firstNonEmpty(response.Status, "CREATED"),
	}, nil
}

func (p PayPalProvider) CaptureCheckout(ctx context.Context, req CheckoutRequest, orderID string) (PaymentCapture, error) {
	if err := validatePayPalCredentials(req); err != nil {
		return PaymentCapture{}, err
	}
	orderID = strings.TrimSpace(orderID)
	if orderID == "" {
		return PaymentCapture{}, errors.New("paypal order id is required")
	}
	token, apiBase, err := p.accessToken(ctx, req)
	if err != nil {
		return PaymentCapture{}, err
	}
	var response struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Payer  struct {
			EmailAddress string `json:"email_address"`
		} `json:"payer"`
		PurchaseUnits []struct {
			Payments struct {
				Captures []struct {
					ID     string `json:"id"`
					Status string `json:"status"`
					Amount struct {
						CurrencyCode string `json:"currency_code"`
						Value        string `json:"value"`
					} `json:"amount"`
				} `json:"captures"`
			} `json:"payments"`
		} `json:"purchase_units"`
	}
	endpoint := apiBase + "/v2/checkout/orders/" + url.PathEscape(orderID) + "/capture"
	if err := p.postJSON(ctx, endpoint, token, requestID("paypal-capture", orderID), map[string]interface{}{}, &response); err != nil {
		// A previous capture can succeed even when its response or our database
		// commit is lost. Read the existing order before treating a retry as failed.
		if lookupErr := p.getJSON(ctx, apiBase+"/v2/checkout/orders/"+url.PathEscape(orderID), token, &response); lookupErr != nil || response.Status != "COMPLETED" {
			return PaymentCapture{}, err
		}
	}
	captureID := ""
	captureStatus := ""
	captureAmount := int64(0)
	captureCurrency := ""
	for _, unit := range response.PurchaseUnits {
		if len(unit.Payments.Captures) > 0 {
			capture := unit.Payments.Captures[0]
			captureID = capture.ID
			captureStatus = capture.Status
			captureCurrency = normalizedCurrency(capture.Amount.CurrencyCode)
			captureAmount = amountStringToCents(capture.Amount.Value)
			break
		}
	}
	status := firstNonEmpty(captureStatus, "NO_CAPTURE")
	return PaymentCapture{
		Provider:    p.Name(),
		ExternalID:  firstNonEmpty(response.ID, orderID),
		CaptureID:   captureID,
		Status:      status,
		OrderStatus: response.Status,
		Amount:      captureAmount,
		Currency:    captureCurrency,
		PayerEmail:  response.Payer.EmailAddress,
	}, nil
}

func (p PayPalProvider) HandleWebhook(_ context.Context, body []byte, _ map[string]string) (string, error) {
	var event struct {
		EventType string `json:"event_type"`
		Resource  struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return "", err
	}
	return firstNonEmpty(event.EventType, event.Resource.Status, "paypal_event"), nil
}

func (p PayPalProvider) RefundPayment(_ context.Context, _ string) error {
	return errors.New("automatic refunds are not implemented; use verified owner settlement")
}

func (p PayPalProvider) getJSON(ctx context.Context, endpoint, token string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("paypal order lookup failed")
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

func (p PayPalProvider) accessToken(ctx context.Context, req CheckoutRequest) (string, string, error) {
	if err := validatePayPalCredentials(req); err != nil {
		return "", "", err
	}
	apiBase := paypalAPIBase(req.Mode)
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+"/v1/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", err
	}
	httpReq.SetBasicAuth(strings.TrimSpace(req.ClientID), strings.TrimSpace(req.ClientSecret))
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.httpClient().Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("paypal access token failed: %s", shortGatewayBody(body))
	}
	var decoded struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", "", err
	}
	if strings.TrimSpace(decoded.AccessToken) == "" {
		return "", "", errors.New("paypal did not return an access token")
	}
	return decoded.AccessToken, apiBase, nil
}

func (p PayPalProvider) postJSON(ctx context.Context, endpoint string, token string, idempotencyKey string, payload interface{}, out interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	if strings.TrimSpace(idempotencyKey) != "" {
		req.Header.Set("PayPal-Request-Id", trimPayPalField(idempotencyKey, 108))
	}
	resp, err := p.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("paypal request failed: %s", shortGatewayBody(respBody))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(respBody, out)
}

func (p PayPalProvider) httpClient() *http.Client {
	if p.client != nil {
		return p.client
	}
	return &http.Client{Timeout: 25 * time.Second}
}

func validatePayPalCheckout(req CheckoutRequest) error {
	if err := validatePayPalCredentials(req); err != nil {
		return err
	}
	if req.Amount <= 0 {
		return errors.New("paypal amount must be greater than zero")
	}
	if strings.TrimSpace(req.ReturnURL) == "" || strings.TrimSpace(req.CancelURL) == "" {
		return errors.New("paypal return and cancel urls are required")
	}
	return nil
}

func validatePayPalCredentials(req CheckoutRequest) error {
	if strings.TrimSpace(req.ClientID) == "" || strings.TrimSpace(req.ClientSecret) == "" {
		return errors.New("paypal client id and secret are required")
	}
	return nil
}

func paypalAPIBase(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "live") {
		return "https://api-m.paypal.com"
	}
	return "https://api-m.sandbox.paypal.com"
}

func normalizedCurrency(currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		return "USD"
	}
	return currency
}

func amountCentsForPayPal(amount int64) string {
	return fmt.Sprintf("%d.%02d", amount/100, amount%100)
}

func amountStringToCents(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	parts := strings.SplitN(value, ".", 2)
	whole := int64(0)
	for _, ch := range parts[0] {
		if ch < '0' || ch > '9' {
			return 0
		}
		whole = whole*10 + int64(ch-'0')
	}
	cents := int64(0)
	if len(parts) > 1 {
		fraction := parts[1]
		if len(fraction) > 2 {
			fraction = fraction[:2]
		}
		for len(fraction) < 2 {
			fraction += "0"
		}
		for _, ch := range fraction {
			if ch < '0' || ch > '9' {
				return 0
			}
			cents = cents*10 + int64(ch-'0')
		}
	}
	return whole*100 + cents
}

func requestID(prefix string, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return prefix + "-" + value
}

func trimPayPalField(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func shortGatewayBody(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return "empty response"
	}
	if len(text) > 240 {
		return text[:240]
	}
	return text
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
