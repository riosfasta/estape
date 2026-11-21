package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
)

func TestCheckoutRegisterValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{
		signupLimits: newRegistrationRateLimiter(),
	}

	router := gin.New()
	api := router.Group("/api")
	api.POST("/subscriptions/checkout-register", s.checkoutRegisterAndPurchase)

	tests := []struct {
		name       string
		body       map[string]any
		wantStatus int
	}{
		{
			name: "missing name",
			body: map[string]any{
				"email":    "test@example.com",
				"password": "password123",
				"plan_id":  "507f1f77bcf86cd799439011",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing email",
			body: map[string]any{
				"name":     "John Doe",
				"password": "password123",
				"plan_id":  "507f1f77bcf86cd799439011",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "password too short",
			body: map[string]any{
				"name":     "John Doe",
				"email":    "john@example.com",
				"password": "short",
				"plan_id":  "507f1f77bcf86cd799439011",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid provider",
			body: map[string]any{
				"name":     "John Doe",
				"email":    "john@example.com",
				"password": "password123",
				"plan_id":  "507f1f77bcf86cd799439011",
				"provider": "unsupported",
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payload, _ := json.Marshal(tc.body)
			req := httptest.NewRequest("POST", "/api/subscriptions/checkout-register", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

func TestPublicVisibleNavItemsIncludesProducts(t *testing.T) {
	items := publicVisibleNavItems([]models.PublicNavItem{})
	found := false
	for _, it := range items {
		if it.URL == "/products" {
			found = true
			if !it.Visible {
				t.Fatal("expected /products to be visible")
			}
			break
		}
	}
	if !found {
		t.Fatal("expected /products in public navigation items")
	}
}
