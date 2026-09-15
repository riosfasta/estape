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

func TestMoveClientWebsiteUpdatesFolderReferences(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_websitemovetest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_websitemovetest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	teamID := primitive.NewObjectID()
	adminID := primitive.NewObjectID()
	sourceClientID := primitive.NewObjectID()
	targetClientID := primitive.NewObjectID()
	websiteID := primitive.NewObjectID()

	_, _ = st.C("users").InsertOne(ctx, models.User{ID: adminID, Role: models.RoleTeamAdmin, TeamID: teamID, Status: models.StatusActive})
	_, _ = st.C("client_projects").InsertMany(ctx, []any{
		models.ClientProject{ID: sourceClientID, TeamID: teamID, CreatedBy: adminID},
		models.ClientProject{ID: targetClientID, TeamID: teamID, CreatedBy: adminID},
	})
	_, _ = st.C("client_websites").InsertOne(ctx, models.ClientWebsite{ID: websiteID, ClientID: sourceClientID, TeamID: teamID, Name: "Movable website", CreatedBy: adminID})

	dependentCollections := []string{"client_tabs", "client_tasks", "client_task_comments", "client_task_logs", "client_documents"}
	for _, collection := range dependentCollections {
		_, _ = st.C(collection).InsertOne(ctx, bson.M{
			"_id":        primitive.NewObjectID(),
			"client_id":  sourceClientID,
			"website_id": websiteID,
		})
	}

	s := &Server{store: st}
	router := gin.New()
	router.PATCH("/api/client-websites/:id", func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: adminID, Role: models.RoleTeamAdmin, TeamID: teamID})
		s.updateClientWebsite(c)
	})

	body, _ := json.Marshal(map[string]string{"client_id": targetClientID.Hex()})
	req, _ := http.NewRequest(http.MethodPatch, "/api/client-websites/"+websiteID.Hex(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 moving website, got %d: %s", response.Code, response.Body.String())
	}

	var movedSite models.ClientWebsite
	if err := st.C("client_websites").FindOne(ctx, bson.M{"_id": websiteID}).Decode(&movedSite); err != nil {
		t.Fatalf("load moved website: %v", err)
	}
	if movedSite.ClientID != targetClientID {
		t.Fatalf("website client_id = %s, want %s", movedSite.ClientID.Hex(), targetClientID.Hex())
	}

	for _, collection := range dependentCollections {
		var moved bson.M
		if err := st.C(collection).FindOne(ctx, bson.M{"website_id": websiteID}).Decode(&moved); err != nil {
			t.Fatalf("load moved %s record: %v", collection, err)
		}
		if got, ok := moved["client_id"].(primitive.ObjectID); !ok || got != targetClientID {
			t.Errorf("%s client_id = %v, want %s", collection, moved["client_id"], targetClientID.Hex())
		}
	}
}
