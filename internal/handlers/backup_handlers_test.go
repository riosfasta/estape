package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestBackupRouteRequiresOwnerAdminRole(t *testing.T) {
	r := gin.New()
	// Mock middleware setting a non-owner user
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   primitive.NewObjectID(),
			Role: models.RoleTeamAdmin,
		})
		c.Next()
	})

	ownerGroup := r.Group("/admin")
	ownerGroup.Use(middleware.RequireRoles(models.RoleOwnerAdmin))
	ownerGroup.GET("/database/overview", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/database/overview", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 Forbidden for non-owner, got %d", w.Code)
	}
}

func TestBackupRestoreRejectsNonZipFile(t *testing.T) {
	s := &Server{}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   primitive.NewObjectID(),
			Role: models.RoleOwnerAdmin,
		})
		c.Next()
	})
	r.POST("/admin/database/restore", s.adminRestoreBackup)

	// Create multipart form with a .txt file instead of .zip
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("backup_file", "backup.txt")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("not a zip file"))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/admin/database/restore", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for non-zip file, got %d", w.Code)
	}
}

func TestMigrationTargetValidation(t *testing.T) {
	s := &Server{}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:   primitive.NewObjectID(),
			Role: models.RoleOwnerAdmin,
		})
		c.Next()
	})
	r.POST("/admin/database/migrate/test", s.adminTestMigrationTarget)

	// Empty target URI
	req := httptest.NewRequest(http.MethodPost, "/admin/database/migrate/test", bytes.NewBufferString(`{"target_uri":""}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for empty target URI, got %d", w.Code)
	}
}
