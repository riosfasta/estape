package handlers

import (
	"context"
	"testing"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestAccessTokenDuration(t *testing.T) {
	tm := auth.NewTokenManager("test-secret-123456789012345678901234")
	user := models.User{
		ID:     primitive.NewObjectID(),
		Role:   models.RoleTeamAdmin,
		TeamID: primitive.NewObjectID(),
	}

	start := time.Now()
	tokenStr, err := tm.GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("unexpected error generating access token: %v", err)
	}

	claims, err := tm.ParseAccessToken(tokenStr)
	if err != nil {
		t.Fatalf("unexpected error parsing access token: %v", err)
	}

	if claims.Subject != user.ID.Hex() {
		t.Fatalf("expected subject %s, got %s", user.ID.Hex(), claims.Subject)
	}

	expiresAt := claims.ExpiresAt.Time
	duration := expiresAt.Sub(start)

	// Access token must last at least 11 hours and up to 12 hours + margin
	if duration < 11*time.Hour || duration > 12*time.Hour+2*time.Minute {
		t.Fatalf("expected access token lifetime to be ~12 hours, got: %v", duration)
	}
}

func TestUserModelRefreshTokenHashesBson(t *testing.T) {
	u := models.User{
		ID:                 primitive.NewObjectID(),
		Name:               "Test User",
		Email:              "test@example.com",
		RefreshTokenHash:   "hash-session-1",
		RefreshTokenHashes: []string{"hash-session-1", "hash-session-2", "hash-session-3"},
	}

	raw, err := bson.Marshal(u)
	if err != nil {
		t.Fatalf("failed to marshal user: %v", err)
	}

	var decoded models.User
	if err := bson.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("failed to unmarshal user: %v", err)
	}

	if decoded.RefreshTokenHash != "hash-session-1" {
		t.Errorf("expected RefreshTokenHash 'hash-session-1', got '%s'", decoded.RefreshTokenHash)
	}
	if len(decoded.RefreshTokenHashes) != 3 {
		t.Fatalf("expected 3 RefreshTokenHashes, got %d", len(decoded.RefreshTokenHashes))
	}
	if decoded.RefreshTokenHashes[1] != "hash-session-2" {
		t.Errorf("expected session 2 hash, got '%s'", decoded.RefreshTokenHashes[1])
	}
}

func TestIssueTokensMultiSessionPush(t *testing.T) {
	tm := auth.NewTokenManager("test-secret-123456789012345678901234")
	s := &Server{
		tokens: tm,
	}

	user := models.User{
		ID:   primitive.NewObjectID(),
		Role: models.RoleTeamAdmin,
	}

	ctx := context.Background()
	access, refresh, err := s.issueTokens(ctx, user)
	if err != nil {
		t.Fatalf("unexpected error in issueTokens without store: %v", err)
	}
	if access == "" {
		t.Error("expected non-empty access token")
	}
	if refresh == "" {
		t.Error("expected non-empty refresh token")
	}

	claims, err := tm.ParseAccessToken(access)
	if err != nil {
		t.Fatalf("expected valid access token: %v", err)
	}
	if claims.Subject != user.ID.Hex() {
		t.Errorf("expected subject %s, got %s", user.ID.Hex(), claims.Subject)
	}
}
