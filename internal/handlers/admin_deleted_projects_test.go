package handlers

import (
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

func TestAdminDeletedProjectsLifecycle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_delprojtest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_delprojtest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}

	ownerID := primitive.NewObjectID()
	userAdminID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()

	// Seed users & team
	_, _ = st.C("users").InsertOne(ctx, models.User{
		ID:       ownerID,
		Name:     "Platform Owner",
		Username: "owner",
		Email:    "owner@example.com",
		Role:     models.RoleOwnerAdmin,
		Status:   models.StatusActive,
	})
	_, _ = st.C("users").InsertOne(ctx, models.User{
		ID:       userAdminID,
		Name:     "User Admin",
		Username: "useradmin",
		Email:    "admin@example.com",
		Role:     models.RoleTeamAdmin,
		TeamID:   teamID,
		Status:   models.StatusActive,
	})
	_, _ = st.C("teams").InsertOne(ctx, models.Team{
		ID:           teamID,
		Name:         "Acme Corp Team",
		OwnerAdminID: userAdminID,
	})

	projectID := primitive.NewObjectID()
	websiteID := primitive.NewObjectID()
	taskID := primitive.NewObjectID()

	_, _ = st.C("client_projects").InsertOne(ctx, models.ClientProject{
		ID:           projectID,
		TeamID:       teamID,
		Name:         "Acme Redesign",
		CompanyEmail: "info@acme.com",
		CreatedBy:    userAdminID,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	})
	_, _ = st.C("client_websites").InsertOne(ctx, models.ClientWebsite{
		ID:        websiteID,
		ClientID:  projectID,
		TeamID:    teamID,
		Name:      "Acme Main Store",
		URL:       "https://acme.example.com",
		CreatedBy: userAdminID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	})
	_, _ = st.C("client_tasks").InsertOne(ctx, models.ClientTask{
		ID:        taskID,
		ClientID:  projectID,
		WebsiteID: websiteID,
		TeamID:    teamID,
		Title:     "Fix checkout bug",
		CreatedBy: userAdminID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	})

	// 1. Verify project is accessible initially
	{
		r := gin.New()
		r.GET("/client-projects/:id", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: userAdminID, Role: models.RoleTeamAdmin, TeamID: teamID})
			s.getClientProject(c)
		})
		req := httptest.NewRequest(http.MethodGet, "/client-projects/"+projectID.Hex(), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for active project, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 2. Soft-delete project as user admin
	{
		r := gin.New()
		r.DELETE("/client-projects/:id", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: userAdminID, Role: models.RoleTeamAdmin, TeamID: teamID})
			s.deleteClientProject(c)
		})
		req := httptest.NewRequest(http.MethodDelete, "/client-projects/"+projectID.Hex(), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 on soft delete, got %d: %s", w.Code, w.Body.String())
		}

		// Verify client_projects has deleted_at set and not permanently deleted
		var p models.ClientProject
		if err := st.C("client_projects").FindOne(ctx, bson.M{"_id": projectID}).Decode(&p); err != nil {
			t.Fatalf("project should not be hard-deleted: %v", err)
		}
		if p.DeletedAt == nil {
			t.Fatal("expected deleted_at to be populated")
		}

		// Verify child website also has deleted_at set
		var site models.ClientWebsite
		if err := st.C("client_websites").FindOne(ctx, bson.M{"_id": websiteID}).Decode(&site); err != nil {
			t.Fatalf("website should not be hard-deleted: %v", err)
		}
		if site.DeletedAt == nil {
			t.Fatal("expected website deleted_at to be populated")
		}
	}

	// 3. Verify client access returns 404
	{
		r := gin.New()
		r.GET("/client-projects/:id", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: userAdminID, Role: models.RoleTeamAdmin, TeamID: teamID})
			s.getClientProject(c)
		})
		req := httptest.NewRequest(http.MethodGet, "/client-projects/"+projectID.Hex(), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for soft-deleted project, got %d", w.Code)
		}
	}

	// 4. Verify Platform Owner sees it in adminListDeletedProjects
	{
		r := gin.New()
		r.GET("/admin/deleted-projects", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: ownerID, Role: models.RoleOwnerAdmin})
			s.adminListDeletedProjects(c)
		})
		req := httptest.NewRequest(http.MethodGet, "/admin/deleted-projects", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 from adminListDeletedProjects, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Projects []AdminDeletedProjectRow `json:"projects"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Projects) != 1 {
			t.Fatalf("expected 1 deleted project, got %d", len(resp.Projects))
		}
		row := resp.Projects[0]
		if row.ID != projectID {
			t.Fatalf("expected project id %s, got %s", projectID.Hex(), row.ID.Hex())
		}
		if row.DomainsCount != 1 {
			t.Fatalf("expected 1 domain count, got %d", row.DomainsCount)
		}
		if row.TasksCount != 1 {
			t.Fatalf("expected 1 task count, got %d", row.TasksCount)
		}
		if row.DaysRemaining < 34 || row.DaysRemaining > 35 {
			t.Fatalf("expected around 35 days remaining, got %d", row.DaysRemaining)
		}
	}

	// 5. Restore project as Platform Owner
	{
		r := gin.New()
		r.POST("/admin/deleted-projects/:id/restore", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: ownerID, Role: models.RoleOwnerAdmin})
			s.adminRestoreDeletedProject(c)
		})
		req := httptest.NewRequest(http.MethodPost, "/admin/deleted-projects/"+projectID.Hex()+"/restore", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 from adminRestoreDeletedProject, got %d: %s", w.Code, w.Body.String())
		}

		// Verify project is restored
		var p models.ClientProject
		if err := st.C("client_projects").FindOne(ctx, bson.M{"_id": projectID}).Decode(&p); err != nil {
			t.Fatalf("failed to load project: %v", err)
		}
		if p.DeletedAt != nil {
			t.Fatal("expected deleted_at to be nil after restore")
		}

		// Verify website is restored
		var site models.ClientWebsite
		if err := st.C("client_websites").FindOne(ctx, bson.M{"_id": websiteID}).Decode(&site); err != nil {
			t.Fatalf("failed to load website: %v", err)
		}
		if site.DeletedAt != nil {
			t.Fatal("expected website deleted_at to be nil after restore")
		}
	}

	// 6. Delete again, then permanently delete as Platform Owner
	{
		// Soft-delete again
		_, _ = st.C("client_projects").UpdateByID(ctx, projectID, bson.M{"$set": bson.M{"deleted_at": time.Now().UTC()}})

		r := gin.New()
		r.DELETE("/admin/deleted-projects/:id/permanent", func(c *gin.Context) {
			c.Set(string(middleware.UserContextKey), middleware.UserContext{ID: ownerID, Role: models.RoleOwnerAdmin})
			s.adminPermanentDeleteProject(c)
		})
		req := httptest.NewRequest(http.MethodDelete, "/admin/deleted-projects/"+projectID.Hex()+"/permanent", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 from adminPermanentDeleteProject, got %d: %s", w.Code, w.Body.String())
		}

		// Verify completely gone
		count, _ := st.C("client_projects").CountDocuments(ctx, bson.M{"_id": projectID})
		if count != 0 {
			t.Fatal("expected project to be completely removed from client_projects")
		}
		siteCount, _ := st.C("client_websites").CountDocuments(ctx, bson.M{"_id": websiteID})
		if siteCount != 0 {
			t.Fatal("expected website to be completely removed from client_websites")
		}
	}

	// 7. Test auto-purge for projects > 35 days old
	{
		oldProjectID := primitive.NewObjectID()
		past36Days := time.Now().UTC().Add(-36 * 24 * time.Hour)
		_, _ = st.C("client_projects").InsertOne(ctx, models.ClientProject{
			ID:        oldProjectID,
			TeamID:    teamID,
			Name:      "Ancient Project",
			DeletedAt: &past36Days,
		})

		s.purgeExpiredDeletedProjects(ctx)

		count, _ := st.C("client_projects").CountDocuments(ctx, bson.M{"_id": oldProjectID})
		if count != 0 {
			t.Fatal("expected expired project (>35 days) to be purged automatically")
		}
	}
}
