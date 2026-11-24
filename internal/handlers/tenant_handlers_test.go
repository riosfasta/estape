package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bugmark/internal/auth"

	"github.com/gin-gonic/gin"
)

func TestTenantSubdomainValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tm := auth.NewTokenManager("test-secret-key-at-least-32-chars-long!")
	s := &Server{
		tokens: tm,
	}

	router := gin.New()
	v1 := router.Group("/api/v1")
	v1.Use(publicCORSMiddleware())
	v1.POST("/forms/submit", s.submitPublicTenantForm)

	// Test form submit with missing fields
	body, _ := json.Marshal(map[string]any{
		"tenant": "",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forms/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for empty tenant, got %d", w.Code)
	}
}

func TestStoreCustomerTokenGeneration(t *testing.T) {
	tm := auth.NewTokenManager("my-super-secret-jwt-key-for-test-32!")
	customerID := "654321654321654321654321"
	tenantID := "123456123456123456123456"
	email := "shopper@gmail.com"

	token, err := tm.GenerateStoreCustomerToken(customerID, tenantID, email)
	if err != nil {
		t.Fatalf("failed to generate store customer token: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := tm.ParseStoreCustomerToken(token)
	if err != nil {
		t.Fatalf("failed to parse store customer token: %v", err)
	}

	if claims.Subject != customerID {
		t.Errorf("expected customer ID %s, got %s", customerID, claims.Subject)
	}
	if claims.TenantID != tenantID {
		t.Errorf("expected tenant ID %s, got %s", tenantID, claims.TenantID)
	}
	if claims.Email != email {
		t.Errorf("expected email %s, got %s", email, claims.Email)
	}
}

func TestPublicCORSMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	v1 := router.Group("/api/v1")
	v1.Use(publicCORSMiddleware())
	v1.OPTIONS("/forms/submit", func(c *gin.Context) { c.Status(http.StatusOK) })
	v1.POST("/forms/submit", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	// Test OPTIONS preflight
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/forms/submit", nil)
	req.Header.Set("Origin", "https://myshop.pages.dev")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for OPTIONS preflight, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "https://myshop.pages.dev" {
		t.Errorf("expected Access-Control-Allow-Origin to match origin, got %s", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestDomainValidationRegex(t *testing.T) {
	valid := []string{"shop.mybrand.com", "www.client.co.uk", "store123.agency.io", "my-store.brand.com"}
	for _, d := range valid {
		if !validDomainRegex.MatchString(d) {
			t.Errorf("expected %s to be valid domain", d)
		}
	}

	invalid := []string{"invalid domain", "http://domain.com", "test@test", "domain..com"}
	for _, d := range invalid {
		if validDomainRegex.MatchString(d) {
			t.Errorf("expected %s to be invalid domain", d)
		}
	}
}
