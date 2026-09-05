package handlers

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
)

func TestConnectsPeriods(t *testing.T) {
	for _, tc := range []struct{ at, period, start, next string }{
		{"2026-09-06T23:59:59Z", "weekly", "2026-08-31T00:00:00Z", "2026-09-07T00:00:00Z"},
		{"2026-09-07T00:00:00Z", "weekly", "2026-09-07T00:00:00Z", "2026-09-14T00:00:00Z"},
		{"2026-09-01T01:00:00+07:00", "monthly", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"},
		{"2026-12-31T23:59:59Z", "monthly", "2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"},
		{"2028-02-29T12:00:00Z", "monthly", "2028-02-01T00:00:00Z", "2028-03-01T00:00:00Z"},
	} {
		now, err := time.Parse(time.RFC3339, tc.at)
		if err != nil {
			t.Fatal(err)
		}
		start, next := connectsPeriod(now, tc.period)
		if start.Format(time.RFC3339) != tc.start || next.Format(time.RFC3339) != tc.next {
			t.Errorf("%s %s: %s to %s", tc.at, tc.period, start, next)
		}
	}
}

func TestConnectsOwnerEndpointsRejectMembers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	for _, tc := range []struct {
		method, path string
		handler      gin.HandlerFunc
	}{
		{"GET", "/connects", s.adminConnects},
		{"PUT", "/policy", s.saveConnectsPolicy},
		{"POST", "/grants", s.grantConnects},
	} {
		router := gin.New()
		router.Use(func(c *gin.Context) {
			c.Set(middleware.UserContextKey, middleware.UserContext{Role: models.RoleMember})
		})
		router.Handle(tc.method, tc.path, tc.handler)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`)))
		if w.Code != 403 {
			t.Errorf("%s %s returned %d", tc.method, tc.path, w.Code)
		}
	}
}
