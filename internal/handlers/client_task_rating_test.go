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

func TestClientTaskRating(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_ratingtest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_ratingtest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}

	adminID := primitive.NewObjectID()
	memberID := primitive.NewObjectID()
	strangerID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()

	// Create users
	_, _ = st.C("users").InsertOne(ctx, models.User{ID: adminID, Role: models.RoleTeamAdmin, TeamID: teamID, Status: models.StatusActive})
	_, _ = st.C("users").InsertOne(ctx, models.User{ID: memberID, Role: models.RoleMember, TeamID: teamID, Status: models.StatusActive})
	_, _ = st.C("users").InsertOne(ctx, models.User{ID: strangerID, Role: models.RoleMember, Status: models.StatusActive})

	// Create client project & website
	clientID := primitive.NewObjectID()
	_, _ = st.C("client_projects").InsertOne(ctx, models.ClientProject{ID: clientID, TeamID: teamID, CreatedBy: adminID, MemberIDs: []primitive.ObjectID{memberID}})

	websiteID := primitive.NewObjectID()
	_, _ = st.C("client_websites").InsertOne(ctx, models.ClientWebsite{
		ID:        websiteID,
		ClientID:  clientID,
		TeamID:    teamID,
		CreatedBy: adminID,
		MemberIDs: []primitive.ObjectID{memberID},
	})

	taskID := primitive.NewObjectID()
	task := models.ClientTask{
		ID:          taskID,
		ClientID:    clientID,
		WebsiteID:   websiteID,
		TeamID:      teamID,
		Title:       "Frontend bugfix",
		Status:      "done",
		AssigneeIDs: []primitive.ObjectID{memberID},
		CreatedBy:   adminID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	_, _ = st.C("client_tasks").InsertOne(ctx, task)

	router := gin.New()
	router.POST("/api/client-tasks/:id/ratings", func(c *gin.Context) {
		authHeader := c.GetHeader("X-User-ID")
		var uid primitive.ObjectID
		if authHeader != "" {
			uid, _ = primitive.ObjectIDFromHex(authHeader)
		}
		var u models.User
		_ = st.C("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u)
		c.Set(middleware.UserContextKey, middleware.UserContext{
			ID:     u.ID,
			Role:   u.Role,
			TeamID: u.TeamID,
		})
		s.createClientTaskRating(c)
	})

	// 1. Invalid rating (>5) returns 400
	{
		body, _ := json.Marshal(map[string]any{"rating": 6, "review": "Superb"})
		req, _ := http.NewRequest("POST", "/api/client-tasks/"+taskID.Hex()+"/ratings", bytes.NewReader(body))
		req.Header.Set("X-User-ID", adminID.Hex())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for rating > 5, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 2. Stranger cannot submit rating
	{
		body, _ := json.Marshal(map[string]any{"rating": 5, "review": "Unauthorized"})
		req, _ := http.NewRequest("POST", "/api/client-tasks/"+taskID.Hex()+"/ratings", bytes.NewReader(body))
		req.Header.Set("X-User-ID", strangerID.Hex())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden && w.Code != http.StatusNotFound {
			t.Fatalf("expected 403 or 404 for stranger, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 3. Admin rates assigned freelancer
	{
		body, _ := json.Marshal(map[string]any{"to_user_id": memberID.Hex(), "rating": 5, "review": "Great job on fixing the bug!"})
		req, _ := http.NewRequest("POST", "/api/client-tasks/"+taskID.Hex()+"/ratings", bytes.NewReader(body))
		req.Header.Set("X-User-ID", adminID.Hex())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for admin rating freelancer, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 4. Freelancer rates admin / client
	{
		body, _ := json.Marshal(map[string]any{"to_user_id": adminID.Hex(), "rating": 5, "review": "Clear instructions and prompt payment!"})
		req, _ := http.NewRequest("POST", "/api/client-tasks/"+taskID.Hex()+"/ratings", bytes.NewReader(body))
		req.Header.Set("X-User-ID", memberID.Hex())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for member rating admin, got %d: %s", w.Code, w.Body.String())
		}
	}

	// Verify ratings are persisted on the task
	var updated models.ClientTask
	if err := st.C("client_tasks").FindOne(ctx, bson.M{"_id": taskID}).Decode(&updated); err != nil {
		t.Fatalf("could not load updated task: %v", err)
	}
	if len(updated.Ratings) != 2 {
		t.Fatalf("expected 2 ratings on task, got %d", len(updated.Ratings))
	}
	if updated.Ratings[0].Role != "admin" || updated.Ratings[0].Rating != 5 {
		t.Errorf("unexpected admin rating: %+v", updated.Ratings[0])
	}
	if updated.Ratings[1].Role != "member" || updated.Ratings[1].Rating != 5 {
		t.Errorf("unexpected member rating: %+v", updated.Ratings[1])
	}
}
