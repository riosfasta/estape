package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"bugmark/internal/config"
	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestAdminListMediaRequiresOwnerAdmin(t *testing.T) {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   primitive.NewObjectID(),
			Role: models.RoleTeamAdmin,
		})
		c.Next()
	})

	ownerGroup := r.Group("/admin")
	ownerGroup.Use(middleware.RequireRoles(models.RoleOwnerAdmin))
	ownerGroup.GET("/media", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/media", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 Forbidden for non-owner, got %d", w.Code)
	}
}

func TestAdminListMediaReturnsImages(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "test-uploads-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a subfolder representing a user upload
	userDir := filepath.Join(tempDir, "users", "123")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("failed to create user dir: %v", err)
	}

	// Create test files
	img1 := filepath.Join(tempDir, "photo1.png")
	if err := os.WriteFile(img1, []byte("png-data"), 0644); err != nil {
		t.Fatalf("failed to write img1: %v", err)
	}

	time.Sleep(10 * time.Millisecond) // ensure time difference
	img2 := filepath.Join(userDir, "banner.webp")
	if err := os.WriteFile(img2, []byte("webp-data-longer"), 0644); err != nil {
		t.Fatalf("failed to write img2: %v", err)
	}

	txtFile := filepath.Join(tempDir, "document.pdf")
	if err := os.WriteFile(txtFile, []byte("pdf-data"), 0644); err != nil {
		t.Fatalf("failed to write pdf: %v", err)
	}

	s := &Server{
		cfg: config.Config{
			UploadDir: tempDir,
		},
	}

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   primitive.NewObjectID(),
			Role: models.RoleOwnerAdmin,
		})
		c.Next()
	})
	r.GET("/api/admin/media", s.adminListMedia)

	req := httptest.NewRequest(http.MethodGet, "/api/admin/media", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var res struct {
		Media []AdminMediaItem `json:"media"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Should only contain photo1.png and banner.webp (not document.pdf)
	if len(res.Media) != 2 {
		t.Fatalf("expected 2 image items, got %d", len(res.Media))
	}

	// img2 was created later so it should be first
	if res.Media[0].Name != "banner.webp" {
		t.Errorf("expected newest first ('banner.webp'), got '%s'", res.Media[0].Name)
	}
	if res.Media[0].URL != "/uploads/users/123/banner.webp" {
		t.Errorf("expected URL '/uploads/users/123/banner.webp', got '%s'", res.Media[0].URL)
	}
	if res.Media[0].Size != int64(len("webp-data-longer")) {
		t.Errorf("expected size %d, got %d", len("webp-data-longer"), res.Media[0].Size)
	}

	if res.Media[1].Name != "photo1.png" {
		t.Errorf("expected second item 'photo1.png', got '%s'", res.Media[1].Name)
	}
	if res.Media[1].URL != "/uploads/photo1.png" {
		t.Errorf("expected URL '/uploads/photo1.png', got '%s'", res.Media[1].URL)
	}
}
