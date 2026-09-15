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

func TestContinuousChatKeyIgnoresDirectParticipantOrder(t *testing.T) {
	first := primitive.NewObjectID()
	second := primitive.NewObjectID()
	teamID := primitive.NewObjectID()
	if got, want := continuousChatKey("direct", first, teamID, []primitive.ObjectID{first, second}), continuousChatKey("direct", second, teamID, []primitive.ObjectID{second, first}); got == "" || got != want {
		t.Fatalf("direct keys differ by participant order: %q != %q", got, want)
	}
	if got := continuousChatKey("direct", first, teamID, []primitive.ObjectID{first, second, primitive.NewObjectID()}); got != "" {
		t.Fatalf("group chat received continuous key %q", got)
	}
	if firstTeam, secondTeam := continuousChatKey("support", first, teamID, []primitive.ObjectID{first}), continuousChatKey("support", first, primitive.NewObjectID(), []primitive.ObjectID{first}); firstTeam == secondTeam {
		t.Fatalf("support key must remain scoped to its workspace: %q", firstTeam)
	}
}

func TestCreateDirectChatReusesExistingConversation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_chatcontinuity_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_chatcontinuity_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	userID := primitive.NewObjectID()
	recipientID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()
	s := &Server{store: st}
	router := gin.New()
	router.POST("/api/chats", func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: userID, Role: models.RoleMember, TeamID: teamID})
		s.createChat(c)
	})
	router.POST("/api/chats/:id/end", func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: userID, Role: models.RoleMember, TeamID: teamID})
		s.endChat(c)
	})

	create := func() primitive.ObjectID {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"type": "direct", "participant_ids": []string{recipientID.Hex()}})
		req := httptest.NewRequest(http.MethodPost, "/api/chats", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusCreated && response.Code != http.StatusOK {
			t.Fatalf("create direct chat returned %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Chat models.Chat `json:"chat"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		return payload.Chat.ID
	}

	firstID := create()
	secondID := create()
	if firstID != secondID {
		t.Fatalf("second direct chat ID = %s, want reused %s", secondID.Hex(), firstID.Hex())
	}
	count, err := st.C("chats").CountDocuments(ctx, bson.M{"type": "direct"})
	if err != nil {
		t.Fatalf("count chats: %v", err)
	}
	if count != 1 {
		t.Fatalf("direct chat count = %d, want 1", count)
	}

	endReq := httptest.NewRequest(http.MethodPost, "/api/chats/"+firstID.Hex()+"/end", bytes.NewReader([]byte("{}")))
	endReq.Header.Set("Content-Type", "application/json")
	endResponse := httptest.NewRecorder()
	router.ServeHTTP(endResponse, endReq)
	if endResponse.Code != http.StatusOK || !strings.Contains(endResponse.Body.String(), `"continuous":true`) {
		t.Fatalf("end continuous chat returned %d: %s", endResponse.Code, endResponse.Body.String())
	}
	var stored models.Chat
	if err := st.C("chats").FindOne(ctx, bson.M{"_id": firstID}).Decode(&stored); err != nil || stored.Status != "open" {
		t.Fatalf("continuous chat did not remain open: chat=%#v err=%v", stored, err)
	}
}

func TestConsolidateSupportChatsPreservesMessages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_chatcontinuity_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_chatcontinuity_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	customerID := primitive.NewObjectID()
	adminID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()
	endedAt := time.Now().Add(-time.Hour)
	oldChat := models.Chat{ID: primitive.NewObjectID(), Type: "support", Title: "Chat for help", ParticipantIDs: []primitive.ObjectID{customerID, adminID}, TeamID: teamID, Status: "ended", EndedAt: &endedAt, CreatedBy: customerID, CreatedAt: time.Now().Add(-24 * time.Hour)}
	newChat := models.Chat{ID: primitive.NewObjectID(), Type: "support", Title: "Chat for help", ParticipantIDs: []primitive.ObjectID{customerID, adminID}, TeamID: teamID, Status: "open", CreatedBy: customerID, CreatedAt: time.Now().Add(-time.Hour)}
	if _, err := st.C("chats").InsertMany(ctx, []any{oldChat, newChat}); err != nil {
		t.Fatalf("insert duplicate chats: %v", err)
	}
	if _, err := st.C("messages").InsertMany(ctx, []any{
		models.Message{ID: primitive.NewObjectID(), ChatID: oldChat.ID, SenderID: customerID, Content: "older", SentAt: time.Now().Add(-23 * time.Hour)},
		models.Message{ID: primitive.NewObjectID(), ChatID: newChat.ID, SenderID: adminID, Content: "newer", SentAt: time.Now().Add(-30 * time.Minute)},
	}); err != nil {
		t.Fatalf("insert messages: %v", err)
	}

	s := &Server{store: st}
	result, err := s.consolidateContinuousChats(ctx, []models.Chat{newChat, oldChat})
	if err != nil {
		t.Fatalf("consolidate chats: %v", err)
	}
	if len(result) != 1 || result[0].ID != oldChat.ID {
		t.Fatalf("consolidated chats = %#v, want oldest chat %s", result, oldChat.ID.Hex())
	}
	if result[0].Status != "open" || result[0].EndedAt != nil {
		t.Fatalf("consolidated chat was not reopened: %#v", result[0])
	}
	chatCount, _ := st.C("chats").CountDocuments(ctx, bson.M{"merged_into": bson.M{"$exists": false}})
	messageCount, _ := st.C("messages").CountDocuments(ctx, bson.M{"chat_id": oldChat.ID})
	if chatCount != 1 || messageCount != 2 {
		t.Fatalf("after consolidation active chats=%d messages=%d, want 1 chat and 2 messages", chatCount, messageCount)
	}
	var retired models.Chat
	if err := st.C("chats").FindOne(ctx, bson.M{"_id": newChat.ID}).Decode(&retired); err != nil || retired.MergedInto != oldChat.ID {
		t.Fatalf("duplicate chat was not safely retired: chat=%#v err=%v", retired, err)
	}
}
