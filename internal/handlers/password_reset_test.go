package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"
	"bugmark/internal/store"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestForgotPasswordAndResetPassword(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_pwresettest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_pwresettest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}

	initialHash, err := auth.HashPassword("OldPassword123!")
	if err != nil {
		t.Fatalf("failed to hash initial password: %v", err)
	}

	userID := primitive.NewObjectID()
	userEmail := "forgot_test@example.com"
	_, err = st.C("users").InsertOne(ctx, models.User{
		ID:           userID,
		Name:         "Forgot User",
		Email:        userEmail,
		Username:     "forgotuser",
		PasswordHash: initialHash,
		Role:         models.RoleMember,
		Status:       models.StatusActive,
	})
	if err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	r := gin.New()
	r.POST("/api/auth/forgot-password", s.forgotPassword)
	r.POST("/api/auth/reset-password", s.resetPassword)

	// 1. Forgot password request for existing user
	forgotPayload, _ := json.Marshal(map[string]string{"email": userEmail})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(forgotPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from forgot-password, got %d: %s", w.Code, w.Body.String())
	}

	var forgotResp struct {
		Sent    bool   `json:"sent"`
		DevCode string `json:"dev_code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &forgotResp); err != nil {
		t.Fatalf("failed to parse forgot-password response: %v", err)
	}
	if !forgotResp.Sent {
		t.Fatalf("expected sent=true in response")
	}
	if forgotResp.DevCode == "" {
		t.Fatalf("expected dev_code when mailer is not configured")
	}

	// 2. Try reset with wrong code
	badResetPayload, _ := json.Marshal(map[string]string{
		"email":        userEmail,
		"code":         "999999",
		"new_password": "BrandNewPassword123!",
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPost, "/api/auth/reset-password", bytes.NewReader(badResetPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong code, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Try reset with too short password
	shortResetPayload, _ := json.Marshal(map[string]string{
		"email":        userEmail,
		"code":         forgotResp.DevCode,
		"new_password": "short",
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPost, "/api/auth/reset-password", bytes.NewReader(shortResetPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for short password, got %d: %s", w.Code, w.Body.String())
	}

	// 4. Successful reset with valid code and new password
	goodResetPayload, _ := json.Marshal(map[string]string{
		"email":        userEmail,
		"code":         forgotResp.DevCode,
		"new_password": "BrandNewPassword123!",
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPost, "/api/auth/reset-password", bytes.NewReader(goodResetPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid reset, got %d: %s", w.Code, w.Body.String())
	}

	// 5. Verify user's password in DB
	var updated models.User
	if err := st.C("users").FindOne(ctx, bson.M{"_id": userID}).Decode(&updated); err != nil {
		t.Fatalf("failed to query updated user: %v", err)
	}
	if auth.ComparePassword(updated.PasswordHash, "BrandNewPassword123!") != nil {
		t.Fatalf("updated password hash does not match new password")
	}
	if auth.ComparePassword(updated.PasswordHash, "OldPassword123!") == nil {
		t.Fatalf("old password still matches!")
	}
}
