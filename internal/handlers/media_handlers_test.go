package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

	ownerID := primitive.NewObjectID()
	otherID := primitive.NewObjectID()
	userDir := filepath.Join(tempDir, userUploadDir(ownerID))
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("failed to create user dir: %v", err)
	}

	// Only the current platform owner's images belong in this library.
	img1 := filepath.Join(userDir, "photo1.png")
	if err := os.WriteFile(img1, []byte("png-data"), 0644); err != nil {
		t.Fatalf("failed to write img1: %v", err)
	}

	time.Sleep(10 * time.Millisecond) // ensure time difference
	nestedDir := filepath.Join(userDir, "page-builder")
	if err := os.MkdirAll(nestedDir, 0755); err != nil {
		t.Fatalf("failed to create nested owner dir: %v", err)
	}
	img2 := filepath.Join(nestedDir, "banner.webp")
	if err := os.WriteFile(img2, []byte("webp-data-longer"), 0644); err != nil {
		t.Fatalf("failed to write img2: %v", err)
	}

	txtFile := filepath.Join(userDir, "document.pdf")
	if err := os.WriteFile(txtFile, []byte("pdf-data"), 0644); err != nil {
		t.Fatalf("failed to write pdf: %v", err)
	}
	otherDir := filepath.Join(tempDir, userUploadDir(otherID))
	if err := os.MkdirAll(otherDir, 0755); err != nil {
		t.Fatalf("failed to create other user dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(otherDir, "private.png"), []byte("other-user"), 0644); err != nil {
		t.Fatalf("failed to write other user's image: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "legacy.png"), []byte("legacy"), 0644); err != nil {
		t.Fatalf("failed to write root image: %v", err)
	}

	s := &Server{
		cfg: config.Config{
			UploadDir: tempDir,
		},
	}

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   ownerID,
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

	// Should only contain this owner's images, not documents, root files, or
	// another user's private uploads.
	if len(res.Media) != 2 {
		t.Fatalf("expected 2 image items, got %d", len(res.Media))
	}

	// img2 was created later so it should be first
	if res.Media[0].Name != "banner.webp" {
		t.Errorf("expected newest first ('banner.webp'), got '%s'", res.Media[0].Name)
	}
	wantBannerURL := userUploadURLPrefix(ownerID) + "page-builder/banner.webp"
	if res.Media[0].URL != wantBannerURL {
		t.Errorf("expected URL %q, got %q", wantBannerURL, res.Media[0].URL)
	}
	if res.Media[0].Size != int64(len("webp-data-longer")) {
		t.Errorf("expected size %d, got %d", len("webp-data-longer"), res.Media[0].Size)
	}

	if res.Media[1].Name != "photo1.png" {
		t.Errorf("expected second item 'photo1.png', got '%s'", res.Media[1].Name)
	}
	wantPhotoURL := userUploadURLPrefix(ownerID) + "photo1.png"
	if res.Media[1].URL != wantPhotoURL {
		t.Errorf("expected URL %q, got %q", wantPhotoURL, res.Media[1].URL)
	}
}

func TestAdminMediaFolderCreationAndDelete(t *testing.T) {
	tempDir := t.TempDir()
	ownerID := primitive.NewObjectID()
	otherID := primitive.NewObjectID()
	s := &Server{cfg: config.Config{UploadDir: tempDir}}

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: ownerID, Role: models.RoleOwnerAdmin})
		c.Next()
	})
	r.GET("/api/admin/media", s.adminListMedia)
	r.DELETE("/api/admin/media", s.adminDeleteMedia)

	listReq := httptest.NewRequest(http.MethodGet, "/api/admin/media", nil)
	listRes := httptest.NewRecorder()
	r.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected empty library status 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	ownerDir := filepath.Join(tempDir, userUploadDir(ownerID))
	if info, err := os.Stat(ownerDir); err != nil || !info.IsDir() {
		t.Fatalf("platform owner media folder was not created: %v", err)
	}

	for _, name := range []string{"one.png", "two.webp"} {
		if err := os.WriteFile(filepath.Join(ownerDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	otherDir := filepath.Join(tempDir, userUploadDir(otherID))
	if err := os.MkdirAll(otherDir, 0755); err != nil {
		t.Fatal(err)
	}
	otherPath := filepath.Join(otherDir, "other.png")
	if err := os.WriteFile(otherPath, []byte("other"), 0644); err != nil {
		t.Fatal(err)
	}

	deleteBody := strings.NewReader(`{"urls":["` + userUploadURLPrefix(ownerID) + `one.png","` + userUploadURLPrefix(ownerID) + `two.webp"]}`)
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/admin/media", deleteBody)
	deleteReq.Header.Set("Content-Type", "application/json")
	deleteRes := httptest.NewRecorder()
	r.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("expected delete status 200, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}
	for _, name := range []string{"one.png", "two.webp"} {
		if _, err := os.Stat(filepath.Join(ownerDir, name)); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be deleted, got %v", name, err)
		}
	}

	foreignBody := strings.NewReader(`{"urls":["` + userUploadURLPrefix(otherID) + `other.png"]}`)
	foreignReq := httptest.NewRequest(http.MethodDelete, "/api/admin/media", foreignBody)
	foreignReq.Header.Set("Content-Type", "application/json")
	foreignRes := httptest.NewRecorder()
	r.ServeHTTP(foreignRes, foreignReq)
	if foreignRes.Code != http.StatusBadRequest {
		t.Fatalf("expected foreign delete status 400, got %d: %s", foreignRes.Code, foreignRes.Body.String())
	}
	if _, err := os.Stat(otherPath); err != nil {
		t.Fatalf("foreign image should not be deleted: %v", err)
	}
}
