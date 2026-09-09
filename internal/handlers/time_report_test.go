package handlers

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestResolveHourlyRates(t *testing.T) {
	s := &Server{}
	user1 := primitive.NewObjectID()
	user2 := primitive.NewObjectID()
	user3 := primitive.NewObjectID()

	team := models.Team{
		MemberHourlyRates: map[string]float64{
			user1.Hex(): 45.50,
			user2.Hex(): 0.0, // explicitly 0
		},
	}

	usersMap := map[string]gin.H{
		user1.Hex(): {
			"id":          user1.Hex(),
			"name":        "Alice",
			"hourly_rate": 30.00, // Profile has 30, but team has 45.50
		},
		user2.Hex(): {
			"id":          user2.Hex(),
			"name":        "Bob",
			"hourly_rate": 25.00, // Team set to 0.0, so team rate takes precedence
		},
		user3.Hex(): {
			"id":          user3.Hex(),
			"name":        "Charlie",
			"hourly_rate": 50.00, // Not in team rates, should fallback to profile
		},
	}

	rates := s.resolveHourlyRates(team, usersMap)

	if rates[user1.Hex()] != 45.50 {
		t.Errorf("expected user1 rate to be 45.50, got %f", rates[user1.Hex()])
	}
	if rates[user2.Hex()] != 0.0 {
		t.Errorf("expected user2 rate to be 0.0, got %f", rates[user2.Hex()])
	}
	if rates[user3.Hex()] != 50.00 {
		t.Errorf("expected user3 rate to be 50.00, got %f", rates[user3.Hex()])
	}
}

func TestTimeEntryFilterRolesAndPaid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}

	adminID := primitive.NewObjectID()
	memberID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()

	// 1. Admin filter with paid=true
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/reports/time?paid=true&user_id="+memberID.Hex(), nil)

		userCtx := middleware.UserContext{
			ID:     adminID,
			Role:   models.RoleTeamAdmin,
			TeamID: teamID,
		}

		filter := s.timeEntryFilter(c, userCtx)
		if filter["team_id"] != teamID {
			t.Errorf("expected team_id %v, got %v", teamID, filter["team_id"])
		}
		if filter["user_id"] != memberID {
			t.Errorf("expected user_id %v, got %v", memberID, filter["user_id"])
		}
		if filter["paid"] != true {
			t.Errorf("expected paid to be true, got %v", filter["paid"])
		}
	}

	// 2. Member filter with paid=false - member CANNOT query other users
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		otherID := primitive.NewObjectID()
		c.Request = httptest.NewRequest(http.MethodGet, "/api/reports/time?paid=false&user_id="+otherID.Hex(), nil)

		userCtx := middleware.UserContext{
			ID:     memberID,
			Role:   models.RoleMember,
			TeamID: teamID,
		}

		filter := s.timeEntryFilter(c, userCtx)
		// Member must be restricted to own ID
		if filter["user_id"] != memberID {
			t.Errorf("member must be restricted to their own user_id, got %v", filter["user_id"])
		}
		if m, ok := filter["paid"].(bson.M); !ok || m["$ne"] != true {
			t.Errorf("expected paid filter to be $ne: true, got %v", filter["paid"])
		}
	}

	// 3. Date range filters
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/reports/time?from=2026-09-01&to=2026-09-09", nil)

		userCtx := middleware.UserContext{
			ID:     adminID,
			Role:   models.RoleTeamAdmin,
			TeamID: teamID,
		}

		filter := s.timeEntryFilter(c, userCtx)
		startTimeFilter, ok := filter["start_time"].(bson.M)
		if !ok {
			t.Fatalf("expected start_time filter, got %v", filter["start_time"])
		}
		expectedGte, _ := time.Parse("2006-01-02", "2026-09-01")
		if startTimeFilter["$gte"] != expectedGte {
			t.Errorf("expected $gte %v, got %v", expectedGte, startTimeFilter["$gte"])
		}
		expectedLte, _ := time.Parse("2006-01-02", "2026-09-09")
		if startTimeFilter["$lte"] != expectedLte.Add(24*time.Hour) {
			t.Errorf("expected $lte %v, got %v", expectedLte.Add(24*time.Hour), startTimeFilter["$lte"])
		}
	}
}

func TestTimeAmountCalculation(t *testing.T) {
	rate := 35.50
	minutes := 90 // 1.5 hours
	hours := float64(minutes) / 60.0
	amount := math.Round(hours*rate*100) / 100.0

	expected := 53.25
	if amount != expected {
		t.Errorf("expected amount %f, got %f", expected, amount)
	}

	// Unpaid vs Paid split
	entries := []models.TimeEntry{
		{DurationMinutes: 60, HourlyRate: 40.0, Paid: false},
		{DurationMinutes: 120, HourlyRate: 40.0, Paid: true},
	}

	unpaidAmount := 0.0
	paidAmount := 0.0
	for _, e := range entries {
		h := float64(e.DurationMinutes) / 60.0
		amt := math.Round(h*e.HourlyRate*100) / 100.0
		if e.Paid {
			paidAmount += amt
		} else {
			unpaidAmount += amt
		}
	}

	if unpaidAmount != 40.0 {
		t.Errorf("expected unpaid amount 40.0, got %f", unpaidAmount)
	}
	if paidAmount != 80.0 {
		t.Errorf("expected paid amount 80.0, got %f", paidAmount)
	}
}
