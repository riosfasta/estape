package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Revalidate module imports as well as the versioned entry point.
func frontendCacheHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/static/") {
			c.Header("Cache-Control", "no-cache, must-revalidate")
		} else if !strings.HasPrefix(c.Request.URL.Path, "/api/") && !strings.HasPrefix(c.Request.URL.Path, "/uploads/") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

func (s *Server) clearFrontendCache(c *gin.Context) {
	s.assetVersion.Store(time.Now().UnixNano())
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"message": "Frontend cache refreshed. Reload the page to load the latest files."})
}
