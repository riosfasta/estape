package handlers

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"bugmark/internal/realtime"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var wsUpgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (s *Server) createChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Type           string   `json:"type"`
		ParticipantIDs []string `json:"participant_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat body"})
		return
	}
	if req.Type == "" {
		req.Type = "team"
	}
	ids, err := objectIDsFromStrings(req.ParticipantIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid participant id"})
		return
	}
	ids = append(ids, userCtx.ID)
	if req.Type == "team" && len(ids) == 1 {
		var team models.Team
		if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team); err == nil {
			ids = team.MemberIDs
		}
	}
	if req.Type == "support" {
		cursor, _ := s.store.C("users").Find(c.Request.Context(), bson.M{"role": models.RoleOwnerAdmin})
		if cursor != nil {
			defer cursor.Close(c.Request.Context())
			for cursor.Next(c.Request.Context()) {
				var owner models.User
				if cursor.Decode(&owner) == nil {
					ids = append(ids, owner.ID)
				}
			}
		}
		adminCursor, _ := s.store.C("users").Find(c.Request.Context(), bson.M{"team_id": userCtx.TeamID, "role": models.RoleTeamAdmin, "status": models.StatusActive})
		if adminCursor != nil {
			defer adminCursor.Close(c.Request.Context())
			for adminCursor.Next(c.Request.Context()) {
				var admin models.User
				if adminCursor.Decode(&admin) == nil {
					ids = append(ids, admin.ID)
				}
			}
		}
	}
	chat := models.Chat{ID: primitive.NewObjectID(), Type: req.Type, ParticipantIDs: uniqueObjectIDs(ids), TeamID: userCtx.TeamID, Status: "open", CreatedBy: userCtx.ID, CreatedAt: time.Now()}
	if _, err := s.store.C("chats").InsertOne(c.Request.Context(), chat); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create chat"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"chat": chat})
}

func (s *Server) listChats(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := bson.M{"participant_ids": userCtx.ID, "deleted_at": bson.M{"$exists": false}}
	if userCtx.Role == models.RoleOwnerAdmin {
		filter = bson.M{}
	} else if userCtx.Role == models.RoleTeamAdmin {
		filter = bson.M{"$or": []bson.M{{"team_id": userCtx.TeamID}, {"participant_ids": userCtx.ID}}}
	}
	cursor, err := s.store.C("chats").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load chats"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var chats []models.Chat
	if err := cursor.All(c.Request.Context(), &chats); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode chats"})
		return
	}
	if chats == nil {
		chats = []models.Chat{}
	}
	c.JSON(http.StatusOK, gin.H{"chats": chats})
}

func (s *Server) chatMessages(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok || !s.userCanAccessChat(c, userCtx, chatID) {
		return
	}
	cursor, err := s.store.C("messages").Find(c.Request.Context(), bson.M{"chat_id": chatID}, options.Find().SetSort(bson.D{{Key: "sent_at", Value: 1}}).SetLimit(250))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load messages"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var messages []models.Message
	if err := cursor.All(c.Request.Context(), &messages); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode messages"})
		return
	}
	if messages == nil {
		messages = []models.Message{}
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

func (s *Server) endChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok || !s.userCanAccessChat(c, userCtx, chatID) {
		return
	}
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if chat.Status == "ended" {
		c.JSON(http.StatusOK, gin.H{"ended": true})
		return
	}
	now := time.Now()
	_, err := s.store.C("chats").UpdateByID(c.Request.Context(), chatID, bson.M{"$set": bson.M{"status": "ended", "ended_at": now, "ended_by": userCtx.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not end chat"})
		return
	}
	actor := "A user"
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		actor = firstNonEmpty(user.Name, user.Username, user.Email, actor)
	}
	for _, participantID := range chat.ParticipantIDs {
		if participantID == userCtx.ID {
			continue
		}
		_, _ = s.store.C("notifications").InsertOne(c.Request.Context(), models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    participantID,
			Type:      "chat_ended",
			Content:   actor + " ended a " + chat.Type + " chat.",
			RelatedID: chatID,
			Read:      false,
			CreatedAt: now,
		})
	}
	out, _ := json.Marshal(gin.H{"type": "chat_ended", "chat_id": chatID, "ended_by": userCtx.ID, "ended_at": now})
	s.hub.Broadcast(chatID.Hex(), out)
	c.JSON(http.StatusOK, gin.H{"ended": true})
}

func (s *Server) deleteChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if !s.canManageChat(userCtx, chat) && !s.canDeleteOwnChat(userCtx, chat) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the chat creator or an admin can delete this chat"})
		return
	}
	if chat.DeletedAt != nil {
		c.JSON(http.StatusOK, gin.H{"deleted": true})
		return
	}
	now := time.Now()
	if _, err := s.store.C("chats").UpdateByID(c.Request.Context(), chatID, bson.M{"$set": bson.M{"deleted_at": now, "deleted_by": userCtx.ID}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete chat"})
		return
	}
	out, _ := json.Marshal(gin.H{"type": "chat_deleted", "chat_id": chatID, "deleted_by": userCtx.ID, "deleted_at": now})
	s.hub.Broadcast(chatID.Hex(), out)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) restoreChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if !s.canManageChat(userCtx, chat) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin can restore this chat"})
		return
	}
	if _, err := s.store.C("chats").UpdateByID(c.Request.Context(), chatID, bson.M{"$unset": bson.M{"deleted_at": "", "deleted_by": ""}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not restore chat"})
		return
	}
	out, _ := json.Marshal(gin.H{"type": "chat_restored", "chat_id": chatID})
	s.hub.Broadcast(chatID.Hex(), out)
	c.JSON(http.StatusOK, gin.H{"restored": true})
}

func (s *Server) permanentlyDeleteChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if !s.canManageChat(userCtx, chat) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin can permanently remove this chat"})
		return
	}
	out, _ := json.Marshal(gin.H{"type": "chat_removed", "chat_id": chatID})
	s.hub.Broadcast(chatID.Hex(), out)
	if _, err := s.store.C("messages").DeleteMany(c.Request.Context(), bson.M{"chat_id": chatID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove chat messages"})
		return
	}
	if _, err := s.store.C("chats").DeleteOne(c.Request.Context(), bson.M{"_id": chatID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove chat"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) chatWebSocket(c *gin.Context) {
	rawToken := strings.TrimSpace(c.Query("token"))
	chatIDRaw := strings.TrimSpace(c.Query("chat_id"))
	if rawToken == "" || chatIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token and chat_id are required"})
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
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	if user.Status == models.StatusSuspended {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is suspended"})
		return
	}
	userCtx := middleware.UserContext{ID: userID, Role: user.Role, TeamID: user.TeamID}
	chatID, err := primitive.ObjectIDFromHex(chatIDRaw)
	if err != nil || !s.userCanAccessChat(c, userCtx, chatID) {
		return
	}
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if chat.DeletedAt != nil {
		c.JSON(http.StatusGone, gin.H{"error": "chat was deleted"})
		return
	}
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	client := &realtime.Client{ChatID: chatID.Hex(), Send: make(chan []byte, 16)}
	s.hub.Register(client)
	defer func() {
		s.hub.Unregister(client)
		_ = conn.Close()
	}()

	go func() {
		for payload := range client.Send {
			_ = conn.WriteMessage(websocket.TextMessage, payload)
		}
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var incoming struct {
			Content        string `json:"content"`
			Type           string `json:"type"`
			ReplyToID      string `json:"reply_to_id"`
			ReplyText      string `json:"reply_text"`
			AttachmentURL  string `json:"attachment_url"`
			AttachmentName string `json:"attachment_name"`
		}
		if json.Unmarshal(payload, &incoming) != nil {
			continue
		}
		incoming.Content = strings.TrimSpace(incoming.Content)
		incoming.AttachmentURL = strings.TrimSpace(incoming.AttachmentURL)
		incoming.AttachmentName = strings.TrimSpace(incoming.AttachmentName)
		if incoming.Content == "" && incoming.AttachmentURL == "" {
			continue
		}
		currentUser, err := s.loadUser(c.Request.Context(), userID)
		if err != nil || currentUser.Status == models.StatusSuspended {
			return
		}
		_ = s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat)
		if chat.Status == "ended" {
			out, _ := json.Marshal(gin.H{"type": "error", "error": "chat has ended"})
			_ = conn.WriteMessage(websocket.TextMessage, out)
			continue
		}
		if chat.DeletedAt != nil {
			out, _ := json.Marshal(gin.H{"type": "error", "error": "chat was deleted"})
			_ = conn.WriteMessage(websocket.TextMessage, out)
			continue
		}
		replyToID := primitive.NilObjectID
		if strings.TrimSpace(incoming.ReplyToID) != "" {
			replyToID, _ = primitive.ObjectIDFromHex(strings.TrimSpace(incoming.ReplyToID))
		}
		msg := models.Message{
			ID:             primitive.NewObjectID(),
			ChatID:         chatID,
			SenderID:       userID,
			Content:        incoming.Content,
			ReplyToID:      replyToID,
			ReplyText:      strings.TrimSpace(incoming.ReplyText),
			AttachmentURL:  incoming.AttachmentURL,
			AttachmentName: incoming.AttachmentName,
			SentAt:         time.Now(),
			ReadBy:         []primitive.ObjectID{userID},
		}
		_, _ = s.store.C("messages").InsertOne(c.Request.Context(), msg)
		s.notifyMentions(c.Request.Context(), chat.TeamID, userID, msg.Content, "chat", msg.ID)
		s.notifyChatMessage(c.Request.Context(), chat, userID, msg)
		out, _ := json.Marshal(gin.H{"type": "message", "message": msg})
		s.hub.Broadcast(chatID.Hex(), out)
	}
}

func (s *Server) notifyChatMessage(ctx context.Context, chat models.Chat, senderID primitive.ObjectID, msg models.Message) {
	recipients := map[primitive.ObjectID]bool{}
	for _, participantID := range chat.ParticipantIDs {
		if participantID != senderID {
			recipients[participantID] = true
		}
	}
	if !chat.TeamID.IsZero() {
		cursor, err := s.store.C("users").Find(ctx, bson.M{"team_id": chat.TeamID, "role": models.RoleTeamAdmin, "status": models.StatusActive})
		if err == nil {
			defer cursor.Close(ctx)
			for cursor.Next(ctx) {
				var admin models.User
				if cursor.Decode(&admin) == nil && admin.ID != senderID {
					recipients[admin.ID] = true
				}
			}
		}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"role": models.RoleOwnerAdmin, "status": models.StatusActive})
	if err == nil {
		defer cursor.Close(ctx)
		for cursor.Next(ctx) {
			var owner models.User
			if cursor.Decode(&owner) == nil && owner.ID != senderID {
				recipients[owner.ID] = true
			}
		}
	}
	actor := "A user"
	if user, err := s.loadUser(ctx, senderID); err == nil {
		actor = firstNonEmpty(user.Name, user.Username, user.Email, actor)
	}
	content := actor + " sent a new message in a " + firstNonEmpty(chat.Type, "chat") + " chat."
	now := msg.SentAt
	if now.IsZero() {
		now = time.Now()
	}
	for recipientID := range recipients {
		_, _ = s.store.C("notifications").InsertOne(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    recipientID,
			Type:      "chat_message",
			Content:   content,
			RelatedID: chat.ID,
			Read:      false,
			CreatedAt: now,
		})
	}
}

func (s *Server) canManageChat(userCtx middleware.UserContext, chat models.Chat) bool {
	if userCtx.Role == models.RoleOwnerAdmin {
		return true
	}
	return userCtx.Role == models.RoleTeamAdmin && (chat.TeamID == userCtx.TeamID || containsObjectID(chat.ParticipantIDs, userCtx.ID))
}

func (s *Server) canDeleteOwnChat(userCtx middleware.UserContext, chat models.Chat) bool {
	if chat.CreatedBy.IsZero() {
		return containsObjectID(chat.ParticipantIDs, userCtx.ID)
	}
	return chat.CreatedBy == userCtx.ID
}

func (s *Server) userCanAccessChat(c *gin.Context, userCtx middleware.UserContext, chatID primitive.ObjectID) bool {
	var chat models.Chat
	if err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{"_id": chatID}).Decode(&chat); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return false
	}
	if chat.DeletedAt != nil && !s.canManageChat(userCtx, chat) {
		c.JSON(http.StatusGone, gin.H{"error": "chat was deleted"})
		return false
	}
	if s.canManageChat(userCtx, chat) || containsObjectID(chat.ParticipantIDs, userCtx.ID) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "chat access denied"})
	return false
}

func (s *Server) startTimer(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		TaskID string `json:"task_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_id is required"})
		return
	}
	taskID, err := objectIDFromString(req.TaskID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task_id"})
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	if isInvitedCompanyRole(userCtx.Role) && !containsObjectID(task.AssigneeIDs, userCtx.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you can only track time on assigned tasks"})
		return
	}
	s.stopActiveTimers(c, userCtx.ID)
	entry := models.TimeEntry{ID: primitive.NewObjectID(), TaskID: taskID, UserID: userCtx.ID, TeamID: teamID, StartTime: time.Now(), DurationMinutes: 0, IsManual: false, Billable: true, CreatedAt: time.Now()}
	if _, err := s.store.C("time_entries").InsertOne(c.Request.Context(), entry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start timer"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"entry": entry, "task": task})
}

func (s *Server) stopTimer(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var entry models.TimeEntry
	if err := s.store.C("time_entries").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&entry); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "time entry not found"})
		return
	}
	if entry.UserID != userCtx.ID && userCtx.Role != models.RoleTeamAdmin && userCtx.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot stop this timer"})
		return
	}
	now := time.Now()
	duration := int(now.Sub(entry.StartTime).Minutes())
	if duration < 1 {
		duration = 1
	}
	_, err := s.store.C("time_entries").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"end_time": now, "duration_minutes": duration}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not stop timer"})
		return
	}
	entry.EndTime = &now
	entry.DurationMinutes = duration
	c.JSON(http.StatusOK, gin.H{"entry": entry})
}

func (s *Server) activeTimer(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var entry models.TimeEntry
	err := s.store.C("time_entries").FindOne(c.Request.Context(), activeTimerFilter(userCtx.ID)).Decode(&entry)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"entry": nil})
		return
	}
	var task models.Task
	_ = s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": entry.TaskID}).Decode(&task)
	c.JSON(http.StatusOK, gin.H{"entry": entry, "task": task})
}

func (s *Server) createManualTimeEntry(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		TaskID          string `json:"task_id"`
		Date            string `json:"date"`
		DurationMinutes int    `json:"duration_minutes"`
		Note            string `json:"note"`
		Billable        *bool  `json:"billable"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.DurationMinutes <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_id and positive duration_minutes are required"})
		return
	}
	taskID, err := objectIDFromString(req.TaskID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task_id"})
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	date := time.Now()
	if strings.TrimSpace(req.Date) != "" {
		parsed, err := time.Parse("2006-01-02", req.Date)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date must be YYYY-MM-DD"})
			return
		}
		date = parsed
	}
	billable := true
	if req.Billable != nil {
		billable = *req.Billable
	}
	end := date.Add(time.Duration(req.DurationMinutes) * time.Minute)
	entry := models.TimeEntry{ID: primitive.NewObjectID(), TaskID: taskID, UserID: userCtx.ID, TeamID: teamID, StartTime: date, EndTime: &end, DurationMinutes: req.DurationMinutes, IsManual: true, Note: strings.TrimSpace(req.Note), Billable: billable, CreatedAt: time.Now()}
	if _, err := s.store.C("time_entries").InsertOne(c.Request.Context(), entry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create time entry"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"entry": entry})
}

func (s *Server) listTimeEntries(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := s.timeEntryFilter(c, userCtx)
	cursor, err := s.store.C("time_entries").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "start_time", Value: -1}}).SetLimit(500))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load time entries"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var entries []models.TimeEntry
	if err := cursor.All(c.Request.Context(), &entries); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode time entries"})
		return
	}
	if entries == nil {
		entries = []models.TimeEntry{}
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (s *Server) updateTimeEntry(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var entry models.TimeEntry
	if err := s.store.C("time_entries").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&entry); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "time entry not found"})
		return
	}
	if entry.UserID != userCtx.ID && userCtx.Role != models.RoleTeamAdmin && userCtx.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot update this entry"})
		return
	}
	var req struct {
		DurationMinutes *int    `json:"duration_minutes"`
		Note            *string `json:"note"`
		Billable        *bool   `json:"billable"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid time entry update"})
		return
	}
	set := bson.M{}
	if req.DurationMinutes != nil && *req.DurationMinutes > 0 {
		set["duration_minutes"] = *req.DurationMinutes
		end := entry.StartTime.Add(time.Duration(*req.DurationMinutes) * time.Minute)
		set["end_time"] = end
	}
	if req.Note != nil {
		set["note"] = strings.TrimSpace(*req.Note)
	}
	if req.Billable != nil {
		set["billable"] = *req.Billable
	}
	if len(set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}
	_, err := s.store.C("time_entries").UpdateByID(c.Request.Context(), id, bson.M{"$set": set})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update time entry"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteTimeEntry(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	filter := bson.M{"_id": id}
	if isInvitedCompanyRole(userCtx.Role) {
		filter["user_id"] = userCtx.ID
	}
	res, err := s.store.C("time_entries").DeleteOne(c.Request.Context(), filter)
	if err != nil || res.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "time entry not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) timeReport(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := s.timeEntryFilter(c, userCtx)
	cursor, err := s.store.C("time_entries").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "start_time", Value: -1}}).SetLimit(1000))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load report"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var entries []models.TimeEntry
	total := 0
	for cursor.Next(c.Request.Context()) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			total += entry.DurationMinutes
			entries = append(entries, entry)
		}
	}
	if entries == nil {
		entries = []models.TimeEntry{}
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries, "total_minutes": total, "group_by": c.Query("group_by")})
}

func (s *Server) timeReportCSV(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := s.timeEntryFilter(c, userCtx)
	cursor, err := s.store.C("time_entries").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "start_time", Value: -1}}).SetLimit(2000))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load report"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{"entry_id", "task_id", "user_id", "date", "minutes", "manual", "billable", "note"})
	for cursor.Next(c.Request.Context()) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			_ = writer.Write([]string{entry.ID.Hex(), entry.TaskID.Hex(), entry.UserID.Hex(), entry.StartTime.Format("2006-01-02"), strconv.Itoa(entry.DurationMinutes), boolText(entry.IsManual), boolText(entry.Billable), entry.Note})
		}
	}
	writer.Flush()
	c.Header("Content-Type", "text/csv")
	c.Header("Content-Disposition", `attachment; filename="time-report.csv"`)
	c.String(http.StatusOK, buf.String())
}

func (s *Server) stopActiveTimers(c *gin.Context, userID primitive.ObjectID) {
	now := time.Now()
	cursor, err := s.store.C("time_entries").Find(c.Request.Context(), activeTimerFilter(userID))
	if err != nil {
		return
	}
	defer cursor.Close(c.Request.Context())
	for cursor.Next(c.Request.Context()) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			duration := int(now.Sub(entry.StartTime).Minutes())
			if duration < 1 {
				duration = 1
			}
			_, _ = s.store.C("time_entries").UpdateByID(c.Request.Context(), entry.ID, bson.M{"$set": bson.M{"end_time": now, "duration_minutes": duration}})
		}
	}
}

func (s *Server) timeEntryFilter(c *gin.Context, userCtx middleware.UserContext) bson.M {
	filter := bson.M{}
	if userCtx.Role == models.RoleOwnerAdmin {
		if teamIDRaw := strings.TrimSpace(c.Query("team_id")); teamIDRaw != "" {
			if teamID, err := objectIDFromString(teamIDRaw); err == nil {
				filter["team_id"] = teamID
			}
		}
	} else {
		filter["team_id"] = userCtx.TeamID
		if isInvitedCompanyRole(userCtx.Role) {
			filter["user_id"] = userCtx.ID
		}
	}
	if userIDRaw := strings.TrimSpace(c.Query("user_id")); userIDRaw != "" && !isInvitedCompanyRole(userCtx.Role) {
		if userID, err := objectIDFromString(userIDRaw); err == nil {
			filter["user_id"] = userID
		}
	}
	if taskIDRaw := strings.TrimSpace(c.Query("task_id")); taskIDRaw != "" {
		if taskID, err := objectIDFromString(taskIDRaw); err == nil {
			filter["task_id"] = taskID
		}
	}
	if from := strings.TrimSpace(c.Query("from")); from != "" {
		if parsed, err := time.Parse("2006-01-02", from); err == nil {
			filter["start_time"] = bson.M{"$gte": parsed}
		}
	}
	if to := strings.TrimSpace(c.Query("to")); to != "" {
		if parsed, err := time.Parse("2006-01-02", to); err == nil {
			existing, _ := filter["start_time"].(bson.M)
			if existing == nil {
				existing = bson.M{}
			}
			existing["$lte"] = parsed.Add(24 * time.Hour)
			filter["start_time"] = existing
		}
	}
	return filter
}

func activeTimerFilter(userID primitive.ObjectID) bson.M {
	return bson.M{"user_id": userID, "$or": []bson.M{{"end_time": bson.M{"$exists": false}}, {"end_time": nil}}}
}

func uniqueObjectIDs(ids []primitive.ObjectID) []primitive.ObjectID {
	seen := map[primitive.ObjectID]bool{}
	out := []primitive.ObjectID{}
	for _, id := range ids {
		if id.IsZero() || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func boolText(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
