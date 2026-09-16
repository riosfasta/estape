package handlers

import (
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type AdminMediaItem struct {
	URL       string    `json:"url"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	UpdatedAt time.Time `json:"updated_at"`
}

var adminMediaImageExtensions = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".gif":  true,
	".webp": true,
}

func (s *Server) adminMediaRoot(ownerID primitive.ObjectID) (string, string, error) {
	uploadDir := s.cfg.UploadDir
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	uploadRoot, err := filepath.Abs(uploadDir)
	if err != nil {
		return "", "", err
	}
	ownerRoot, err := filepath.Abs(filepath.Join(uploadRoot, userUploadDir(ownerID)))
	if err != nil {
		return "", "", err
	}
	rel, err := filepath.Rel(uploadRoot, ownerRoot)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", "", errors.New("owner media directory is outside configured upload root")
	}
	if err := os.MkdirAll(ownerRoot, 0755); err != nil {
		return "", "", err
	}
	resolvedUploadRoot, err := filepath.EvalSymlinks(uploadRoot)
	if err != nil {
		return "", "", err
	}
	resolvedOwnerRoot, err := filepath.EvalSymlinks(ownerRoot)
	if err != nil {
		return "", "", err
	}
	resolvedRel, err := filepath.Rel(resolvedUploadRoot, resolvedOwnerRoot)
	if err != nil || resolvedRel == "." || strings.HasPrefix(resolvedRel, "..") || filepath.IsAbs(resolvedRel) {
		return "", "", errors.New("owner media directory resolves outside configured upload root")
	}
	return ownerRoot, userUploadURLPrefix(ownerID), nil
}

func (s *Server) adminMediaPath(ownerID primitive.ObjectID, rawURL string) (string, error) {
	ownerRoot, urlPrefix, err := s.adminMediaRoot(ownerID)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || !strings.HasPrefix(parsed.Path, urlPrefix) {
		return "", errors.New("image does not belong to the platform owner")
	}
	relURL, err := url.PathUnescape(strings.TrimPrefix(parsed.Path, urlPrefix))
	if err != nil || relURL == "" || strings.Contains(relURL, `\`) || !adminMediaImageExtensions[strings.ToLower(filepath.Ext(relURL))] {
		return "", errors.New("invalid owner image path")
	}
	target, err := filepath.Abs(filepath.Join(ownerRoot, filepath.FromSlash(relURL)))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(ownerRoot, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", errors.New("image path is outside the platform owner folder")
	}
	resolvedRoot, err := filepath.EvalSymlinks(ownerRoot)
	if err != nil {
		return "", err
	}
	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return "", err
	}
	resolvedRel, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil || resolvedRel == "." || strings.HasPrefix(resolvedRel, "..") || filepath.IsAbs(resolvedRel) {
		return "", errors.New("image resolves outside the platform owner folder")
	}
	return target, nil
}

func (s *Server) adminListMedia(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok || user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "platform owner access required"})
		return
	}
	base, urlPrefix, err := s.adminMediaRoot(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare platform owner media folder"})
		return
	}

	items := make([]AdminMediaItem, 0)
	_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d == nil || d.IsDir() || d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !adminMediaImageExtensions[ext] {
			return nil
		}
		rel, relErr := filepath.Rel(base, path)
		if relErr != nil {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return nil
		}
		items = append(items, AdminMediaItem{
			URL:       urlPrefix + filepath.ToSlash(rel),
			Name:      d.Name(),
			Size:      info.Size(),
			UpdatedAt: info.ModTime(),
		})
		return nil
	})

	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	c.JSON(http.StatusOK, gin.H{"media": items})
}

func (s *Server) adminDeleteMedia(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok || user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "platform owner access required"})
		return
	}
	var req struct {
		URLs []string `json:"urls"`
	}
	if c.ShouldBindJSON(&req) != nil || len(req.URLs) == 0 || len(req.URLs) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select between 1 and 200 images to delete"})
		return
	}

	targets := make([]string, 0, len(req.URLs))
	deletedURLs := make([]string, 0, len(req.URLs))
	seen := make(map[string]bool, len(req.URLs))
	for _, rawURL := range req.URLs {
		target, err := s.adminMediaPath(user.ID, rawURL)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if seen[target] {
			continue
		}
		info, err := os.Lstat(target)
		if err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "one or more selected images no longer exist"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not inspect selected image"})
			return
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "selected media is not a deletable image"})
			return
		}
		seen[target] = true
		targets = append(targets, target)
		deletedURLs = append(deletedURLs, strings.TrimSpace(rawURL))
	}

	for _, target := range targets {
		if err := os.Remove(target); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete selected images"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"deleted": deletedURLs, "deleted_count": len(deletedURLs)})
}
