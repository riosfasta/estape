package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"bugmark/internal/store"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestAdminConflictAuditAndResolution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_conflicttest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_conflicttest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}

	ownerID := primitive.NewObjectID()
	adminID := primitive.NewObjectID()
	freelancerID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()

	// Seed users
	_, _ = st.C("users").InsertOne(ctx, models.User{
		ID:       ownerID,
		Name:     "Platform Owner",
		Username: "owner",
		Email:    "owner@example.com",
		Role:     models.RoleOwnerAdmin,
		Status:   models.StatusActive,
	})
	_, _ = st.C("users").InsertOne(ctx, models.User{
		ID:       adminID,
		Name:     "Acme Admin",
		Username: "acme_admin",
		Email:    "admin@acme.com",
		Role:     models.RoleTeamAdmin,
		TeamID:   teamID,
		Status:   models.StatusActive,
	})
	_, _ = st.C("users").InsertOne(ctx, models.User{
		ID:         freelancerID,
		Name:       "Jane Freelancer",
		Username:   "jane_free",
		Email:      "jane@example.com",
		Role:       models.RoleMember,
		HourlyRate: 45.0,
		Status:     models.StatusActive,
	})
	_, _ = st.C("teams").InsertOne(ctx, models.Team{
		ID:           teamID,
		Name:         "Acme Corp",
		OwnerAdminID: adminID,
	})

	// Seed client project & task
	clientID := primitive.NewObjectID()
	_, _ = st.C("client_projects").InsertOne(ctx, models.ClientProject{
		ID:        clientID,
		Name:      "Website Redesign",
		TeamID:    teamID,
		CreatedBy: adminID,
		MemberIDs: []primitive.ObjectID{freelancerID},
	})

	taskID := primitive.NewObjectID()
	_, _ = st.C("client_tasks").InsertOne(ctx, models.ClientTask{
		ID:            taskID,
		ClientID:      clientID,
		TeamID:        teamID,
		CreatedBy:     adminID,
		AssigneeIDs:   []primitive.ObjectID{freelancerID},
		Title:         "Frontend Landing Page",
		Status:        "done",
		Price:         500.0,
		PaymentStatus: "unpaid",
		Ratings: []models.TaskRating{
			{
				FromUserID: adminID,
				ToUserID:   freelancerID,
				Role:       "admin",
				Rating:     2,
				Review:     "Delayed delivery and missed requirements",
				CreatedAt:  time.Now(),
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	// Seed time entry
	_, _ = st.C("time_entries").InsertOne(ctx, models.TimeEntry{
		ID:              primitive.NewObjectID(),
		TaskID:          taskID,
		UserID:          freelancerID,
		TeamID:          teamID,
		DurationMinutes: 120,
		HourlyRate:      45.0,
		Paid:            false,
		StartTime:       time.Now(),
		CreatedAt:       time.Now(),
	})

	// Setup router for conflict endpoints
	r := gin.New()
	setupAuth := func(u models.User) gin.HandlerFunc {
		return func(c *gin.Context) {
			c.Set(middleware.UserContextKey, middleware.UserContext{
				ID:     u.ID,
				Role:   u.Role,
				TeamID: u.TeamID,
			})
			c.Next()
		}
	}

	ownerGroup := r.Group("/api/admin")
	ownerGroup.Use(setupAuth(models.User{ID: ownerID, Role: models.RoleOwnerAdmin}))
	ownerGroup.GET("/conflicts/overview", s.adminConflictsOverview)
	ownerGroup.GET("/conflicts/audit", s.adminConflictsAudit)
	ownerGroup.POST("/conflicts/resolve", s.adminConflictsResolve)

	// Test 1: Overview
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/admin/conflicts/overview", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on overview, got %d: %s", w.Code, w.Body.String())
	}
	var overviewResp struct {
		KPIs struct {
			TotalAdmins        int     `json:"total_admins"`
			TotalFreelancers   int     `json:"total_freelancers"`
			DisputedTasksCount int     `json:"disputed_tasks_count"`
			TotalPayroll       float64 `json:"total_payroll"`
		} `json:"kpis"`
		Admins        []gin.H `json:"admins"`
		Freelancers   []gin.H `json:"freelancers"`
		DisputedTasks []gin.H `json:"disputed_tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &overviewResp); err != nil {
		t.Fatalf("failed to decode overview response: %v", err)
	}
	if overviewResp.KPIs.TotalAdmins != 1 {
		t.Errorf("expected 1 admin, got %d", overviewResp.KPIs.TotalAdmins)
	}
	if overviewResp.KPIs.TotalFreelancers != 1 {
		t.Errorf("expected 1 freelancer, got %d", overviewResp.KPIs.TotalFreelancers)
	}
	if overviewResp.KPIs.DisputedTasksCount < 1 {
		t.Errorf("expected at least 1 disputed task, got %d", overviewResp.KPIs.DisputedTasksCount)
	}
	if len(overviewResp.DisputedTasks) == 0 {
		t.Fatalf("expected disputed tasks list to be populated")
	}

	// Test 2: Audit endpoint
	wAudit := httptest.NewRecorder()
	reqAudit, _ := http.NewRequest(http.MethodGet, "/api/admin/conflicts/audit?admin_id="+adminID.Hex()+"&freelancer_id="+freelancerID.Hex(), nil)
	r.ServeHTTP(wAudit, reqAudit)
	if wAudit.Code != http.StatusOK {
		t.Fatalf("expected 200 on audit, got %d: %s", wAudit.Code, wAudit.Body.String())
	}
	var auditResp struct {
		Admin      gin.H   `json:"admin"`
		Freelancer gin.H   `json:"freelancer"`
		Tasks      []gin.H `json:"tasks"`
		Summary    gin.H   `json:"summary"`
	}
	if err := json.Unmarshal(wAudit.Body.Bytes(), &auditResp); err != nil {
		t.Fatalf("failed to decode audit response: %v", err)
	}
	if auditResp.Admin["id"] != adminID.Hex() {
		t.Errorf("expected admin ID %s, got %v", adminID.Hex(), auditResp.Admin["id"])
	}
	if auditResp.Freelancer["id"] != freelancerID.Hex() {
		t.Errorf("expected freelancer ID %s, got %v", freelancerID.Hex(), auditResp.Freelancer["id"])
	}
	if len(auditResp.Tasks) != 1 {
		t.Errorf("expected 1 shared task, got %d", len(auditResp.Tasks))
	}

	// Test 3: Resolve endpoint
	resolvePayload, _ := json.Marshal(gin.H{
		"task_id":         taskID.Hex(),
		"action":          "mark_paid",
		"resolution_note": "Platform owner approved deliverable and recorded payment settlement",
	})
	wResolve := httptest.NewRecorder()
	reqResolve, _ := http.NewRequest(http.MethodPost, "/api/admin/conflicts/resolve", bytes.NewReader(resolvePayload))
	reqResolve.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(wResolve, reqResolve)
	if wResolve.Code != http.StatusOK {
		t.Fatalf("expected 200 on resolve, got %d: %s", wResolve.Code, wResolve.Body.String())
	}

	// Verify task payment status is now paid
	var updatedTask models.ClientTask
	_ = st.C("client_tasks").FindOne(ctx, bson.M{"_id": taskID}).Decode(&updatedTask)
	if updatedTask.PaymentStatus != "paid" {
		t.Errorf("expected task payment_status to be 'paid', got '%s'", updatedTask.PaymentStatus)
	}

	// Test 4: Time report for RoleTeamAdmin populates members and freelancers
	timeReportRouter := gin.New()
	timeReportRouter.Use(setupAuth(models.User{ID: adminID, Role: models.RoleTeamAdmin, TeamID: teamID}))
	timeReportRouter.GET("/api/reports/time", s.timeReport)

	wReport := httptest.NewRecorder()
	reqReport, _ := http.NewRequest(http.MethodGet, "/api/reports/time", nil)
	timeReportRouter.ServeHTTP(wReport, reqReport)
	if wReport.Code != http.StatusOK {
		t.Fatalf("expected 200 on time report, got %d: %s", wReport.Code, wReport.Body.String())
	}
	var reportResp struct {
		IsAdmin     bool    `json:"is_admin"`
		Users       gin.H   `json:"users"`
		UserSummary []gin.H `json:"user_summary"`
	}
	if err := json.Unmarshal(wReport.Body.Bytes(), &reportResp); err != nil {
		t.Fatalf("failed to decode time report response: %v", err)
	}
	if !reportResp.IsAdmin {
		t.Errorf("expected is_admin to be true for RoleTeamAdmin")
	}
	if _, found := reportResp.Users[freelancerID.Hex()]; !found {
		t.Errorf("expected freelancer %s to be populated in users map for user_admin", freelancerID.Hex())
	}
	if len(reportResp.UserSummary) == 0 {
		t.Errorf("expected user_summary to be populated for user_admin")
	}
}
