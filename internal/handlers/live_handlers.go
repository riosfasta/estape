package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/models"
	"bugmark/internal/realtime"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func (s *Server) liveWebSocket(c *gin.Context) {
	rawToken := strings.TrimSpace(c.Query("token"))
	if rawToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token is required"})
		return
	}
	claims, err := s.tokens.ParseAccessToken(rawToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}
	userID, err := primitive.ObjectIDFromHex(claims.Subject)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token subject"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userID)
	if err != nil || user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
		return
	}
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	client := &realtime.Client{ChatID: liveUserChannel(userID), Send: make(chan []byte, 32)}
	s.hub.Register(client)
	defer func() {
		s.hub.Unregister(client)
		_ = conn.Close()
	}()

	connected, _ := json.Marshal(gin.H{"type": "live_connected", "at": time.Now()})
	_ = conn.WriteMessage(websocket.TextMessage, connected)

	go func() {
		for payload := range client.Send {
			_ = conn.WriteMessage(websocket.TextMessage, payload)
		}
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func liveUserChannel(userID primitive.ObjectID) string {
	return "user:" + userID.Hex()
}

func (s *Server) broadcastLiveToUsers(userIDs []primitive.ObjectID, event string, data gin.H) {
	payload := gin.H{"type": event, "at": time.Now()}
	for key, value := range data {
		payload[key] = value
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, userID := range uniqueObjectIDs(userIDs) {
		if userID.IsZero() {
			continue
		}
		s.hub.Broadcast(liveUserChannel(userID), out)
	}
}

func (s *Server) clientWebsiteLiveRecipients(ctx context.Context, site models.ClientWebsite) []primitive.ObjectID {
	recipients := append([]primitive.ObjectID{}, site.MemberIDs...)
	recipients = append(recipients, site.ClientAdminIDs...)
	recipients = append(recipients, site.CreatedBy)

	var client models.ClientProject
	if s.store.C("client_projects").FindOne(ctx, bson.M{"_id": site.ClientID}).Decode(&client) == nil {
		recipients = append(recipients, client.MemberIDs...)
		recipients = append(recipients, client.ClientAdminIDs...)
		recipients = append(recipients, client.CreatedBy)
	}

	cursor, err := s.store.C("users").Find(ctx, bson.M{"team_id": site.TeamID, "role": models.RoleTeamAdmin, "status": models.StatusActive})
	if err == nil {
		defer cursor.Close(ctx)
		for cursor.Next(ctx) {
			var user models.User
			if cursor.Decode(&user) == nil {
				recipients = append(recipients, user.ID)
			}
		}
	}
	return uniqueObjectIDs(recipients)
}

func (s *Server) clientTaskLiveRecipients(ctx context.Context, task models.ClientTask) []primitive.ObjectID {
	recipients := s.clientTaskNotificationRecipients(ctx, task)
	var site models.ClientWebsite
	if s.store.C("client_websites").FindOne(ctx, bson.M{"_id": task.WebsiteID}).Decode(&site) == nil {
		recipients = append(recipients, s.clientWebsiteLiveRecipients(ctx, site)...)
	}
	return uniqueObjectIDs(recipients)
}

func (s *Server) broadcastClientTaskChanged(ctx context.Context, task models.ClientTask, actorID primitive.ObjectID, event string) {
	recipients := s.clientTaskLiveRecipients(ctx, task)
	recipients = append(recipients, actorID)
	s.broadcastLiveToUsers(recipients, event, gin.H{
		"task_id":    task.ID.Hex(),
		"client_id":  task.ClientID.Hex(),
		"website_id": task.WebsiteID.Hex(),
		"tab_id":     task.TabID.Hex(),
	})
}

func (s *Server) broadcastClientWebsiteChanged(ctx context.Context, site models.ClientWebsite, actorID primitive.ObjectID, event string, data gin.H) {
	recipients := s.clientWebsiteLiveRecipients(ctx, site)
	recipients = append(recipients, actorID)
	payload := gin.H{
		"client_id":  site.ClientID.Hex(),
		"website_id": site.ID.Hex(),
	}
	for key, value := range data {
		payload[key] = value
	}
	s.broadcastLiveToUsers(recipients, event, payload)
}

func (s *Server) broadcastClientTabChanged(ctx context.Context, tab models.ClientTab, actorID primitive.ObjectID, event string) {
	var site models.ClientWebsite
	if s.store.C("client_websites").FindOne(ctx, bson.M{"_id": tab.WebsiteID}).Decode(&site) != nil {
		return
	}
	s.broadcastClientWebsiteChanged(ctx, site, actorID, event, gin.H{"tab_id": tab.ID.Hex()})
}
