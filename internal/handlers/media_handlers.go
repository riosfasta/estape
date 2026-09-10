package handlers

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type AdminMediaItem struct {
	URL       string    `json:"url"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Server) adminListMedia(c *gin.Context) {
	uploadDir := s.cfg.UploadDir
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	base, err := filepath.Abs(uploadDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid upload directory"})
		return
	}

	validExt := map[string]bool{
		".png":  true,
		".jpg":  true,
		".jpeg": true,
		".gif":  true,
		".webp": true,
	}

	items := make([]AdminMediaItem, 0)
	if _, err := os.Stat(base); err == nil {
		_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d == nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if !validExt[ext] {
				return nil
			}
			rel, relErr := filepath.Rel(base, path)
			if relErr != nil {
				return nil
			}
			info, infoErr := d.Info()
			if infoErr != nil {
				return nil
			}
			items = append(items, AdminMediaItem{
				URL:       "/uploads/" + filepath.ToSlash(rel),
				Name:      d.Name(),
				Size:      info.Size(),
				UpdatedAt: info.ModTime(),
			})
			return nil
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	c.JSON(http.StatusOK, gin.H{"media": items})
}
