package handlers

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"bugmark/internal/backup"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func (s *Server) adminDatabaseOverview(c *gin.Context) {
	stats, err := backup.GetDatabaseStats(c.Request.Context(), s.store.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to inspect database: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func (s *Server) adminDownloadBackup(c *gin.Context) {
	userCtx, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	dbName := s.store.DB.Name()
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("bugmega-backup-%s-%s.zip", dbName, timestamp)

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate")

	manifest, err := backup.CreateBackupZip(c.Request.Context(), s.store.DB, c.Writer)
	if err != nil {
		s.logger.Printf("backup export error: %v", err)
		return
	}

	s.audit(c.Request.Context(), userCtx.ID, "database.backup.downloaded", "database", primitive.NilObjectID)
	s.logger.Printf("database backup completed for %s: %d collections, %d documents", manifest.DatabaseName, manifest.TotalCollections, manifest.TotalDocuments)
}

func (s *Server) adminRestoreBackup(c *gin.Context) {
	userCtx, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	file, err := c.FormFile("backup_file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "backup zip file is required"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".zip" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .zip backup archives are supported"})
		return
	}

	mode := strings.ToLower(strings.TrimSpace(c.DefaultPostForm("mode", "upsert")))
	cleanExisting := (mode == "clean")

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not open uploaded file"})
		return
	}
	defer f.Close()

	result, err := backup.RestoreBackupZip(c.Request.Context(), s.store.DB, f, file.Size, cleanExisting)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("restore failed: %v", err)})
		return
	}

	// Re-synchronize application schema indexes after restore
	if err := s.store.CreateIndexes(c.Request.Context()); err != nil {
		s.logger.Printf("warning: post-restore create indexes: %v", err)
	}

	s.audit(c.Request.Context(), userCtx.ID, "database.backup.restored", "database", primitive.NilObjectID)
	c.JSON(http.StatusOK, gin.H{
		"message": "database restore completed successfully",
		"result":  result,
	})
}

type testMigrationRequest struct {
	TargetURI string `json:"target_uri"`
	TargetDB  string `json:"target_db"`
}

func (s *Server) adminTestMigrationTarget(c *gin.Context) {
	var req testMigrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	res, err := backup.TestMongoConnection(c.Request.Context(), req.TargetURI, req.TargetDB)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

type executeMigrationRequest struct {
	TargetURI   string `json:"target_uri"`
	TargetDB    string `json:"target_db"`
	CleanTarget bool   `json:"clean_target"`
}

func (s *Server) adminExecuteMigration(c *gin.Context) {
	userCtx, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req executeMigrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	res, err := backup.MigrateLive(c.Request.Context(), s.store.DB, req.TargetURI, req.TargetDB, req.CleanTarget)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("live migration failed: %v", err)})
		return
	}

	s.audit(c.Request.Context(), userCtx.ID, "database.live_migrated", "database", primitive.NilObjectID)
	c.JSON(http.StatusOK, gin.H{
		"message": "live migration completed successfully",
		"result":  res,
	})
}
