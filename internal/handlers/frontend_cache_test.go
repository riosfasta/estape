package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestFrontendCacheHeaders(t *testing.T) {
	for _, tc := range []struct{ path, want string }{
		{"/static/js/app.js", "no-cache, must-revalidate"},
		{"/dashboard", "no-store"},
		{"/api/tasks", ""},
		{"/uploads/photo.png", ""},
	} {
		router := gin.New()
		router.Use(frontendCacheHeaders())
		router.GET(tc.path, func(c *gin.Context) { c.Status(http.StatusOK) })
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if got := response.Header().Get("Cache-Control"); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestClearFrontendCache(t *testing.T) {
	s := &Server{}
	s.assetVersion.Store(1)
	router := gin.New()
	router.POST("/clear", s.clearFrontendCache)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/clear", nil))
	if response.Code != http.StatusOK || s.assetVersion.Load() <= 1 {
		t.Fatalf("cache version was not refreshed: status %d, version %d", response.Code, s.assetVersion.Load())
	}
}
