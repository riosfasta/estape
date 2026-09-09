package handlers

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
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

func normalizeChatTitle(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return ""
	}
	runes := []rune(value)
	if len(runes) > 80 {
		return ""
	}
	return value
}

func chatDisplayTitle(chat models.Chat) string {
	if strings.TrimSpace(chat.Title) != "" {
		return strings.TrimSpace(chat.Title)
	}
	if chat.Type == "support" {
		return "Chat for help"
	}
	if chat.Type == "direct" {
		return "Direct chat"
	}
	return firstNonEmpty(chat.Type, "chat") + " chat"
}

func (s *Server) createChat(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Type           string   `json:"type"`
		Title          string   `json:"title"`
		ParticipantIDs []string `json:"participant_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat body"})
		return
	}
	if req.Type == "" {
		req.Type = "team"
	}
	title := normalizeChatTitle(req.Title)
	if strings.TrimSpace(req.Title) != "" && title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat title is too long"})
		return
	}
	ids, err := objectIDsFromStrings(req.ParticipantIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid participant id"})
		return
	}
	if req.Type != "support" && len(ids) > 1 && title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat title is required for group chats"})
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
	if req.Type == "support" && title == "" {
		title = "Chat for help"
	}
	chat := models.Chat{ID: primitive.NewObjectID(), Type: req.Type, Title: title, ParticipantIDs: uniqueObjectIDs(ids), TeamID: userCtx.TeamID, Status: "open", CreatedBy: userCtx.ID, CreatedAt: time.Now()}
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
	filter["hidden_for"] = bson.M{"$ne": userCtx.ID}
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
	if err := s.populateChatListProfiles(c.Request.Context(), chats, userCtx.ID, userCtx.Role); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load conversation profiles"})
		return
	}
	if err := s.populateChatUnread(c.Request.Context(), chats, userCtx.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load unread counts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chats": chats})
}

func (s *Server) chatMessages(c *gin.Context) {
	userCtx, _ := currentUser(c)
	chatID, ok := objectIDParam(c, "id")
	if !ok || !s.userCanAccessChat(c, userCtx, chatID) {
		return
	}
	cursor, err := s.store.C("messages").Find(c.Request.Context(), bson.M{"chat_id": chatID}, options.Find().SetSort(bson.D{{Key: "sent_at", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(250))
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
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
	senderIDs := make([]primitive.ObjectID, 0, len(messages))
	for _, message := range messages {
		senderIDs = append(senderIDs, message.SenderID)
	}
	senders, err := s.chatSenders(c.Request.Context(), senderIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load chat sender profiles"})
		return
	}
	for i := range messages {
		messages[i].Sender = senders[messages[i].SenderID]
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
	for _, participantID := range s.userNotificationRecipients(c.Request.Context(), chat.ParticipantIDs, userCtx.ID) {
		s.insertNotification(c.Request.Context(), models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    participantID,
			Type:      "chat_ended",
			Content:   actor + " ended " + chatDisplayTitle(chat) + ".",
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
	s.setChatHidden(c, true)
}

func (s *Server) restoreChat(c *gin.Context) {
	s.setChatHidden(c, false)
}

// Keep old clients safe: this endpoint now deletes only the caller's copy too.
func (s *Server) permanentlyDeleteChat(c *gin.Context) {
	s.setChatHidden(c, true)
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
	senders, err := s.chatSenders(c.Request.Context(), []primitive.ObjectID{userID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load chat sender profile"})
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
		if _, err := s.store.C("messages").InsertOne(c.Request.Context(), msg); err != nil {
			out, _ := json.Marshal(gin.H{"type": "error", "error": "Message could not be saved. Please try again."})
			_ = conn.WriteMessage(websocket.TextMessage, out)
			continue
		}
		msg.Sender = senders[userID]
		_, _ = s.store.C("chats").UpdateByID(c.Request.Context(), chatID, bson.M{"$unset": bson.M{"hidden_for": ""}})
		s.notifyMentions(c.Request.Context(), chat.TeamID, userID, msg.Content, "chat", msg.ID)
		s.notifyChatMessage(c.Request.Context(), chat, userID, msg)
		out, _ := json.Marshal(gin.H{"type": "message", "message": msg})
		s.hub.Broadcast(chatID.Hex(), out)
	}
}

func shouldNotifySupportOwners(chat models.Chat, sender models.User) bool {
	return chat.Type == "support" && !sender.ID.IsZero() && sender.Role != models.RoleOwnerAdmin
}

func (s *Server) notifyChatMessage(ctx context.Context, chat models.Chat, senderID primitive.ObjectID, msg models.Message) {
	recipients := map[primitive.ObjectID]bool{}
	for _, participantID := range chat.ParticipantIDs {
		if participantID != senderID {
			recipients[participantID] = true
		}
	}
	actor := "A user"
	if user, err := s.loadUser(ctx, senderID); err == nil {
		actor = firstNonEmpty(user.Name, user.Username, user.Email, actor)
		if shouldNotifySupportOwners(chat, user) {
			s.notifyOwnerAdmins(ctx, senderID, "chat_message", actor+" sent a new support message.", chat.ID)
			s.enqueueOwnerNewChatEmail(ctx, chat, senderID)
		}
	}
	content := actor + " sent a new message in " + chatDisplayTitle(chat) + "."
	now := msg.SentAt
	if now.IsZero() {
		now = time.Now()
	}
	recipientIDs := []primitive.ObjectID{}
	for recipientID := range recipients {
		recipientIDs = append(recipientIDs, recipientID)
	}
	for _, recipientID := range s.userNotificationRecipients(ctx, recipientIDs, senderID) {
		s.insertNotification(ctx, models.Notification{
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
	teamID, taskPayload, ok := s.resolveTimerTask(c, taskID, userCtx)
	if !ok {
		return
	}
	s.stopActiveTimers(c, userCtx.ID)
	entry := models.TimeEntry{ID: primitive.NewObjectID(), TaskID: taskID, UserID: userCtx.ID, TeamID: teamID, StartTime: time.Now(), DurationMinutes: 0, IsManual: false, Billable: true, CreatedAt: time.Now()}
	if _, err := s.store.C("time_entries").InsertOne(c.Request.Context(), entry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start timer"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"entry": entry, "task": taskPayload})
}

func (s *Server) resolveTimerTask(c *gin.Context, taskID primitive.ObjectID, userCtx middleware.UserContext) (primitive.ObjectID, interface{}, bool) {
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err == nil {
		teamID, err := s.teamForList(c.Request.Context(), task.ListID)
		if err != nil || !s.canAccessTeam(c, teamID) {
			return primitive.NilObjectID, nil, false
		}
		if isInvitedCompanyRole(userCtx.Role) && !containsObjectID(task.AssigneeIDs, userCtx.ID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "you can only track time on assigned tasks"})
			return primitive.NilObjectID, nil, false
		}
		return teamID, task, true
	}
	var clientTask models.ClientTask
	if err := s.store.C("client_tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&clientTask); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return primitive.NilObjectID, nil, false
	}
	client, ok := s.loadClientProjectForAccess(c, clientTask.ClientID, false)
	if !ok {
		return primitive.NilObjectID, nil, false
	}
	if isInvitedCompanyRole(userCtx.Role) && !containsObjectID(clientTask.AssigneeIDs, userCtx.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you can only track time on assigned tasks"})
		return primitive.NilObjectID, nil, false
	}
	teamID := clientTask.TeamID
	if teamID.IsZero() {
		teamID = client.TeamID
	}
	return teamID, clientTask, true
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
	if !entry.MarketplaceJobID.IsZero() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Contract timer entries are protected; use the shared task workspace"})
		return
	}
	if entry.UserID != userCtx.ID && userCtx.Role != models.RoleTeamAdmin && userCtx.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot stop this timer"})
		return
	}
	now := time.Now()
	seconds := int64(now.Sub(entry.StartTime) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	duration := int((seconds + 59) / 60)
	if duration < 1 {
		duration = 1
	}
	_, err := s.store.C("time_entries").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"end_time": now, "duration_minutes": duration, "duration_seconds": seconds}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not stop timer"})
		return
	}
	entry.EndTime = &now
	entry.DurationMinutes = duration
	entry.DurationSeconds = seconds
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
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": entry.TaskID}).Decode(&task); err == nil {
		c.JSON(http.StatusOK, gin.H{"entry": entry, "task": task})
		return
	}
	var clientTask models.ClientTask
	if err := s.store.C("client_tasks").FindOne(c.Request.Context(), bson.M{"_id": entry.TaskID}).Decode(&clientTask); err == nil {
		c.JSON(http.StatusOK, gin.H{"entry": entry, "task": clientTask})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entry": entry, "task": nil})
}

func (s *Server) createManualTimeEntry(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		TaskID          string `json:"task_id"`
		Date            string `json:"date"`
		StartTime       string `json:"start_time"`
		EndTime         string `json:"end_time"`
		DurationMinutes int    `json:"duration_minutes"`
		Note            string `json:"note"`
		Billable        *bool  `json:"billable"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid time entry payload"})
		return
	}
	taskID, err := objectIDFromString(req.TaskID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task_id"})
		return
	}
	teamID, _, ok := s.resolveTimerTask(c, taskID, userCtx)
	if !ok {
		return
	}
	date := time.Now()
	if strings.TrimSpace(req.Date) != "" {
		parsed, err := time.Parse("2006-01-02", req.Date)
		if err == nil {
			date = parsed
		}
	}
	startTime := date
	if strings.TrimSpace(req.StartTime) != "" {
		if t, err := time.Parse(time.RFC3339, req.StartTime); err == nil {
			startTime = t
		} else if t, err := time.Parse("15:04", req.StartTime); err == nil {
			startTime = time.Date(date.Year(), date.Month(), date.Day(), t.Hour(), t.Minute(), 0, 0, date.Location())
		}
	}
	endTime := startTime.Add(time.Duration(req.DurationMinutes) * time.Minute)
	if strings.TrimSpace(req.EndTime) != "" {
		if t, err := time.Parse(time.RFC3339, req.EndTime); err == nil {
			endTime = t
		} else if t, err := time.Parse("15:04", req.EndTime); err == nil {
			endTime = time.Date(date.Year(), date.Month(), date.Day(), t.Hour(), t.Minute(), 0, 0, date.Location())
		}
	}
	if req.DurationMinutes <= 0 && endTime.After(startTime) {
		req.DurationMinutes = int(endTime.Sub(startTime) / time.Minute)
	}
	if req.DurationMinutes <= 0 {
		req.DurationMinutes = 1
		endTime = startTime.Add(time.Minute)
	}
	billable := true
	if req.Billable != nil {
		billable = *req.Billable
	}
	entry := models.TimeEntry{
		ID:              primitive.NewObjectID(),
		TaskID:          taskID,
		UserID:          userCtx.ID,
		TeamID:          teamID,
		StartTime:       startTime,
		EndTime:         &endTime,
		DurationMinutes: req.DurationMinutes,
		DurationSeconds: int64(req.DurationMinutes * 60),
		IsManual:        true,
		Note:            strings.TrimSpace(req.Note),
		Billable:        billable,
		CreatedAt:       time.Now(),
	}
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
	usersMap := s.populateTimeEntryUsers(c.Request.Context(), entries)
	c.JSON(http.StatusOK, gin.H{"entries": entries, "users": usersMap})
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
	if !entry.MarketplaceJobID.IsZero() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Hourly contract time records cannot be manually edited"})
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
	filter := bson.M{"_id": id, "marketplace_job_id": bson.M{"$exists": false}}
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

func (s *Server) setMemberHourlyRate(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if userCtx.Role != models.RoleOwnerAdmin && userCtx.Role != models.RoleTeamAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "only admins can manage hourly rates"})
		return
	}
	targetUserID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	var req struct {
		HourlyRate float64 `json:"hourly_rate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.HourlyRate < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid hourly rate"})
		return
	}
	roundedRate := math.Round(req.HourlyRate*100) / 100.0

	// If userCtx has a TeamID, save to team.member_hourly_rates
	if !userCtx.TeamID.IsZero() {
		_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), userCtx.TeamID, bson.M{
			"$set": bson.M{"member_hourly_rates." + targetUserID.Hex(): roundedRate},
		})
	}
	// Also update user's profile hourly_rate as default
	_, _ = s.store.C("users").UpdateByID(c.Request.Context(), targetUserID, bson.M{
		"$set": bson.M{"hourly_rate": roundedRate},
	})

	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"user_id":     targetUserID.Hex(),
		"hourly_rate": roundedRate,
	})
}

func (s *Server) markTimeEntriesPaid(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if userCtx.Role != models.RoleOwnerAdmin && userCtx.Role != models.RoleTeamAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "only admins can manage payments"})
		return
	}

	var req struct {
		UserID   string   `json:"user_id"`
		EntryIDs []string `json:"entry_ids"`
		From     string   `json:"from"`
		To       string   `json:"to"`
		Paid     *bool    `json:"paid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	isPaid := true
	if req.Paid != nil {
		isPaid = *req.Paid
	}

	filter := bson.M{}
	if !userCtx.TeamID.IsZero() {
		filter["team_id"] = userCtx.TeamID
	}

	hasTarget := false
	if len(req.EntryIDs) > 0 {
		var oids []primitive.ObjectID
		for _, raw := range req.EntryIDs {
			if id, err := objectIDFromString(strings.TrimSpace(raw)); err == nil {
				oids = append(oids, id)
			}
		}
		if len(oids) > 0 {
			filter["_id"] = bson.M{"$in": oids}
			hasTarget = true
		}
	}

	if strings.TrimSpace(req.UserID) != "" {
		if uid, err := objectIDFromString(strings.TrimSpace(req.UserID)); err == nil {
			filter["user_id"] = uid
			hasTarget = true
		}
	}

	if from := strings.TrimSpace(req.From); from != "" {
		if parsed, err := time.Parse("2006-01-02", from); err == nil {
			filter["start_time"] = bson.M{"$gte": parsed}
		}
	}
	if to := strings.TrimSpace(req.To); to != "" {
		if parsed, err := time.Parse("2006-01-02", to); err == nil {
			existing, _ := filter["start_time"].(bson.M)
			if existing == nil {
				existing = bson.M{}
			}
			existing["$lte"] = parsed.Add(24 * time.Hour)
			filter["start_time"] = existing
		}
	}

	if !hasTarget {
		c.JSON(http.StatusBadRequest, gin.H{"error": "must specify user_id or entry_ids to mark payment status"})
		return
	}

	now := time.Now()
	updateFields := bson.M{"paid": isPaid}
	if isPaid {
		updateFields["paid_at"] = now
	} else {
		updateFields["paid_at"] = nil
	}

	res, err := s.store.C("time_entries").UpdateMany(c.Request.Context(), filter, bson.M{"$set": updateFields})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update payment status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"modified_count": res.ModifiedCount,
		"paid":           isPaid,
	})
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
	for cursor.Next(c.Request.Context()) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			entries = append(entries, entry)
		}
	}
	if entries == nil {
		entries = []models.TimeEntry{}
	}

	var team models.Team
	if !userCtx.TeamID.IsZero() {
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team)
	}

	isAdmin := userCtx.Role == models.RoleOwnerAdmin || userCtx.Role == models.RoleTeamAdmin

	usersMap := s.populateTimeEntryUsers(c.Request.Context(), entries)
	s.populateTimeEntryMetadata(c.Request.Context(), entries)

	// If isAdmin, ensure all workspace team members are in usersMap so their rates & zero-hour stats are visible
	if isAdmin && len(team.MemberIDs) > 0 {
		mCursor, err := s.store.C("users").Find(c.Request.Context(), bson.M{"_id": bson.M{"$in": team.MemberIDs}})
		if err == nil {
			defer mCursor.Close(c.Request.Context())
			for mCursor.Next(c.Request.Context()) {
				var u models.User
				if mCursor.Decode(&u) == nil {
					uHex := u.ID.Hex()
					if _, exists := usersMap[uHex]; !exists {
						displayName := strings.TrimSpace(u.Name)
						if displayName == "" {
							displayName = strings.TrimSpace(u.Username)
						}
						if displayName == "" {
							displayName = strings.TrimSpace(u.Email)
						}
						usersMap[uHex] = gin.H{
							"id":          uHex,
							"name":        displayName,
							"email":       u.Email,
							"username":    u.Username,
							"avatar_url":  u.AvatarURL,
							"role":        u.Role,
							"hourly_rate": u.HourlyRate,
						}
					}
				}
			}
		}
	}

	rates := s.resolveHourlyRates(team, usersMap)

	type UserSummary struct {
		UserID          string  `json:"user_id"`
		Name            string  `json:"name"`
		Email           string  `json:"email"`
		AvatarURL       string  `json:"avatar_url"`
		Role            string  `json:"role"`
		HourlyRate      float64 `json:"hourly_rate"`
		TotalMinutes    int     `json:"total_minutes"`
		TotalHours      float64 `json:"total_hours"`
		BillableMinutes int     `json:"billable_minutes"`
		BillableHours   float64 `json:"billable_hours"`
		TotalAmount     float64 `json:"total_amount"`
		UnpaidAmount    float64 `json:"unpaid_amount"`
		PaidAmount      float64 `json:"paid_amount"`
		EntryCount      int     `json:"entry_count"`
		UnpaidCount     int     `json:"unpaid_count"`
	}

	type TaskSummary struct {
		TaskID          string  `json:"task_id"`
		Title           string  `json:"title"`
		ProjectName     string  `json:"project_name"`
		WebsiteName     string  `json:"website_name"`
		TotalMinutes    int     `json:"total_minutes"`
		TotalHours      float64 `json:"total_hours"`
		BillableMinutes int     `json:"billable_minutes"`
		BillableHours   float64 `json:"billable_hours"`
		TotalAmount     float64 `json:"total_amount"`
		UnpaidAmount    float64 `json:"unpaid_amount"`
		PaidAmount      float64 `json:"paid_amount"`
		EntryCount      int     `json:"entry_count"`
	}

	userSummaryMap := make(map[string]*UserSummary)
	for uHex, uInfo := range usersMap {
		// Non-admins must only see their own summary
		if !isAdmin && uHex != userCtx.ID.Hex() {
			continue
		}
		name, _ := uInfo["name"].(string)
		email, _ := uInfo["email"].(string)
		avatar, _ := uInfo["avatar_url"].(string)
		roleStr := ""
		if r, ok := uInfo["role"].(models.Role); ok {
			roleStr = string(r)
		} else if r, ok := uInfo["role"].(string); ok {
			roleStr = r
		}
		userSummaryMap[uHex] = &UserSummary{
			UserID:     uHex,
			Name:       name,
			Email:      email,
			AvatarURL:  avatar,
			Role:       roleStr,
			HourlyRate: rates[uHex],
		}
	}

	taskSummaryMap := make(map[string]*TaskSummary)

	totalMinutes := 0
	billableMinutes := 0
	totalAmount := 0.0
	unpaidAmount := 0.0
	paidAmount := 0.0
	unpaidCount := 0

	for i := range entries {
		uHex := entries[i].UserID.Hex()
		rate := rates[uHex]
		if entries[i].HourlyRate == 0 {
			entries[i].HourlyRate = rate
		}
		hrs := float64(entries[i].DurationMinutes) / 60.0
		amount := math.Round(hrs*entries[i].HourlyRate*100) / 100.0
		entries[i].Amount = amount

		totalMinutes += entries[i].DurationMinutes
		if entries[i].Billable {
			billableMinutes += entries[i].DurationMinutes
		}
		totalAmount += amount
		if entries[i].Paid {
			paidAmount += amount
		} else {
			unpaidAmount += amount
			unpaidCount++
		}

		if us, ok := userSummaryMap[uHex]; ok {
			us.TotalMinutes += entries[i].DurationMinutes
			if entries[i].Billable {
				us.BillableMinutes += entries[i].DurationMinutes
			}
			us.TotalAmount += amount
			if entries[i].Paid {
				us.PaidAmount += amount
			} else {
				us.UnpaidAmount += amount
				us.UnpaidCount++
			}
			us.EntryCount++
		}

		tKey := entries[i].TaskID.Hex()
		if tKey == "" || entries[i].TaskID.IsZero() {
			tKey = "unassigned_" + entries[i].TaskTitle
		}
		ts, ok := taskSummaryMap[tKey]
		if !ok {
			ts = &TaskSummary{
				TaskID:      entries[i].TaskID.Hex(),
				Title:       entries[i].TaskTitle,
				ProjectName: entries[i].ProjectName,
				WebsiteName: entries[i].WebsiteName,
			}
			taskSummaryMap[tKey] = ts
		}
		ts.TotalMinutes += entries[i].DurationMinutes
		if entries[i].Billable {
			ts.BillableMinutes += entries[i].DurationMinutes
		}
		ts.TotalAmount += amount
		if entries[i].Paid {
			ts.PaidAmount += amount
		} else {
			ts.UnpaidAmount += amount
		}
		ts.EntryCount++
	}

	var userSummaries []UserSummary
	for _, us := range userSummaryMap {
		us.TotalHours = math.Round((float64(us.TotalMinutes)/60.0)*100) / 100.0
		us.BillableHours = math.Round((float64(us.BillableMinutes)/60.0)*100) / 100.0
		us.TotalAmount = math.Round(us.TotalAmount*100) / 100.0
		us.UnpaidAmount = math.Round(us.UnpaidAmount*100) / 100.0
		us.PaidAmount = math.Round(us.PaidAmount*100) / 100.0
		userSummaries = append(userSummaries, *us)
	}

	var taskSummaries []TaskSummary
	for _, ts := range taskSummaryMap {
		ts.TotalHours = math.Round((float64(ts.TotalMinutes)/60.0)*100) / 100.0
		ts.BillableHours = math.Round((float64(ts.BillableMinutes)/60.0)*100) / 100.0
		ts.TotalAmount = math.Round(ts.TotalAmount*100) / 100.0
		ts.UnpaidAmount = math.Round(ts.UnpaidAmount*100) / 100.0
		ts.PaidAmount = math.Round(ts.PaidAmount*100) / 100.0
		taskSummaries = append(taskSummaries, *ts)
	}

	myRate := rates[userCtx.ID.Hex()]

	summary := gin.H{
		"total_minutes":    totalMinutes,
		"total_hours":      math.Round((float64(totalMinutes)/60.0)*100) / 100.0,
		"billable_minutes": billableMinutes,
		"billable_hours":   math.Round((float64(billableMinutes)/60.0)*100) / 100.0,
		"total_amount":     math.Round(totalAmount*100) / 100.0,
		"unpaid_amount":    math.Round(unpaidAmount*100) / 100.0,
		"paid_amount":      math.Round(paidAmount*100) / 100.0,
		"entry_count":      len(entries),
		"unpaid_count":     unpaidCount,
		"is_admin":         isAdmin,
		"can_manage_rates": isAdmin,
		"my_hourly_rate":   myRate,
	}

	filteredUsersMap := make(map[string]gin.H)
	if isAdmin {
		filteredUsersMap = usersMap
	} else {
		if myInfo, ok := usersMap[userCtx.ID.Hex()]; ok {
			filteredUsersMap[userCtx.ID.Hex()] = myInfo
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"entries":          entries,
		"total_minutes":    totalMinutes,
		"summary":          summary,
		"user_summary":     userSummaries,
		"task_summary":     taskSummaries,
		"users":            filteredUsersMap,
		"is_admin":         isAdmin,
		"can_manage_rates": isAdmin,
		"group_by":         c.Query("group_by"),
	})
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
	var entries []models.TimeEntry
	for cursor.Next(c.Request.Context()) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			entries = append(entries, entry)
		}
	}

	var team models.Team
	if !userCtx.TeamID.IsZero() {
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": userCtx.TeamID}).Decode(&team)
	}

	usersMap := s.populateTimeEntryUsers(c.Request.Context(), entries)
	s.populateTimeEntryMetadata(c.Request.Context(), entries)
	rates := s.resolveHourlyRates(team, usersMap)

	for i := range entries {
		uHex := entries[i].UserID.Hex()
		rate := rates[uHex]
		if entries[i].HourlyRate == 0 {
			entries[i].HourlyRate = rate
		}
		hrs := float64(entries[i].DurationMinutes) / 60.0
		entries[i].Amount = math.Round(hrs*entries[i].HourlyRate*100) / 100.0
	}

	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{
		"entry_id",
		"task_id",
		"task_title",
		"project_name",
		"website_name",
		"user_id",
		"user_name",
		"date",
		"minutes",
		"hours",
		"hourly_rate",
		"amount",
		"billable",
		"paid",
		"note",
	})
	for _, entry := range entries {
		hours := fmt.Sprintf("%.2f", float64(entry.DurationMinutes)/60.0)
		rateStr := fmt.Sprintf("%.2f", entry.HourlyRate)
		amountStr := fmt.Sprintf("%.2f", entry.Amount)
		_ = writer.Write([]string{
			entry.ID.Hex(),
			entry.TaskID.Hex(),
			entry.TaskTitle,
			entry.ProjectName,
			entry.WebsiteName,
			entry.UserID.Hex(),
			entry.UserName,
			entry.StartTime.Format("2006-01-02"),
			strconv.Itoa(entry.DurationMinutes),
			hours,
			rateStr,
			amountStr,
			boolText(entry.Billable),
			boolText(entry.Paid),
			entry.Note,
		})
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
			seconds := int64(now.Sub(entry.StartTime) / time.Second)
			if seconds < 1 {
				seconds = 1
			}
			duration := int((seconds + 59) / 60)
			if duration < 1 {
				duration = 1
			}
			_, _ = s.store.C("time_entries").UpdateByID(c.Request.Context(), entry.ID, bson.M{"$set": bson.M{"end_time": now, "duration_minutes": duration, "duration_seconds": seconds}})
		}
	}
}

func (s *Server) populateTimeEntryUsers(ctx context.Context, entries []models.TimeEntry) map[string]gin.H {
	usersMap := make(map[string]gin.H)
	if len(entries) == 0 {
		return usersMap
	}
	userIDs := make([]primitive.ObjectID, 0, len(entries))
	for _, e := range entries {
		if !e.UserID.IsZero() {
			userIDs = append(userIDs, e.UserID)
		}
	}
	userIDs = uniqueObjectIDs(userIDs)
	if len(userIDs) == 0 {
		return usersMap
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": userIDs}})
	if err != nil {
		return usersMap
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var u models.User
		if cursor.Decode(&u) == nil {
			displayName := strings.TrimSpace(u.Name)
			if displayName == "" {
				displayName = strings.TrimSpace(u.Username)
			}
			if displayName == "" {
				displayName = strings.TrimSpace(u.Email)
			}
			usersMap[u.ID.Hex()] = gin.H{
				"id":          u.ID.Hex(),
				"name":        displayName,
				"email":       u.Email,
				"username":    u.Username,
				"avatar_url":  u.AvatarURL,
				"role":        u.Role,
				"hourly_rate": u.HourlyRate,
			}
		}
	}
	for i := range entries {
		if u, ok := usersMap[entries[i].UserID.Hex()]; ok {
			if name, ok := u["name"].(string); ok {
				entries[i].UserName = name
			}
			if email, ok := u["email"].(string); ok {
				entries[i].UserEmail = email
			}
		}
	}
	return usersMap
}

func (s *Server) populateTimeEntryMetadata(ctx context.Context, entries []models.TimeEntry) {
	if len(entries) == 0 {
		return
	}
	taskIDs := make([]primitive.ObjectID, 0, len(entries))
	for _, e := range entries {
		if !e.TaskID.IsZero() {
			taskIDs = append(taskIDs, e.TaskID)
		}
	}
	taskIDs = uniqueObjectIDs(taskIDs)
	if len(taskIDs) == 0 {
		for i := range entries {
			if strings.TrimSpace(entries[i].Note) != "" {
				entries[i].TaskTitle = entries[i].Note
			} else {
				entries[i].TaskTitle = "Unassigned time"
			}
		}
		return
	}

	taskTitles := make(map[primitive.ObjectID]string)
	taskProjects := make(map[primitive.ObjectID]string)
	taskWebsites := make(map[primitive.ObjectID]string)

	// 1. Regular space tasks
	taskCursor, err := s.store.C("tasks").Find(ctx, bson.M{"_id": bson.M{"$in": taskIDs}})
	if err == nil {
		defer taskCursor.Close(ctx)
		var listIDs []primitive.ObjectID
		var tasks []models.Task
		for taskCursor.Next(ctx) {
			var t models.Task
			if taskCursor.Decode(&t) == nil {
				tasks = append(tasks, t)
				taskTitles[t.ID] = t.Title
				if !t.ListID.IsZero() {
					listIDs = append(listIDs, t.ListID)
				}
			}
		}
		listIDs = uniqueObjectIDs(listIDs)
		if len(listIDs) > 0 {
			listMap := make(map[primitive.ObjectID]primitive.ObjectID)
			listCursor, err := s.store.C("lists").Find(ctx, bson.M{"_id": bson.M{"$in": listIDs}})
			if err == nil {
				defer listCursor.Close(ctx)
				var projectIDs []primitive.ObjectID
				for listCursor.Next(ctx) {
					var l models.List
					if listCursor.Decode(&l) == nil {
						listMap[l.ID] = l.ProjectID
						if !l.ProjectID.IsZero() {
							projectIDs = append(projectIDs, l.ProjectID)
						}
					}
				}
				projectIDs = uniqueObjectIDs(projectIDs)
				if len(projectIDs) > 0 {
					projectMap := make(map[primitive.ObjectID]string)
					projCursor, err := s.store.C("projects").Find(ctx, bson.M{"_id": bson.M{"$in": projectIDs}})
					if err == nil {
						defer projCursor.Close(ctx)
						for projCursor.Next(ctx) {
							var p models.Project
							if projCursor.Decode(&p) == nil {
								projectMap[p.ID] = p.Name
							}
						}
					}
					for _, t := range tasks {
						if projID, ok := listMap[t.ListID]; ok {
							if projName, ok := projectMap[projID]; ok {
								taskProjects[t.ID] = projName
							}
						}
					}
				}
			}
		}
	}

	// 2. Client tasks
	ctCursor, err := s.store.C("client_tasks").Find(ctx, bson.M{"_id": bson.M{"$in": taskIDs}})
	if err == nil {
		defer ctCursor.Close(ctx)
		var clientIDs []primitive.ObjectID
		var websiteIDs []primitive.ObjectID
		var clientTasks []models.ClientTask
		for ctCursor.Next(ctx) {
			var ct models.ClientTask
			if ctCursor.Decode(&ct) == nil {
				clientTasks = append(clientTasks, ct)
				taskTitles[ct.ID] = ct.Title
				if !ct.ClientID.IsZero() {
					clientIDs = append(clientIDs, ct.ClientID)
				}
				if !ct.WebsiteID.IsZero() {
					websiteIDs = append(websiteIDs, ct.WebsiteID)
				}
			}
		}
		clientIDs = uniqueObjectIDs(clientIDs)
		clientNames := make(map[primitive.ObjectID]string)
		if len(clientIDs) > 0 {
			cCursor, err := s.store.C("client_projects").Find(ctx, bson.M{"_id": bson.M{"$in": clientIDs}})
			if err == nil {
				defer cCursor.Close(ctx)
				for cCursor.Next(ctx) {
					var cp models.ClientProject
					if cCursor.Decode(&cp) == nil {
						clientNames[cp.ID] = cp.Name
					}
				}
			}
		}
		websiteIDs = uniqueObjectIDs(websiteIDs)
		websiteNames := make(map[primitive.ObjectID]string)
		if len(websiteIDs) > 0 {
			wCursor, err := s.store.C("client_websites").Find(ctx, bson.M{"_id": bson.M{"$in": websiteIDs}})
			if err == nil {
				defer wCursor.Close(ctx)
				for wCursor.Next(ctx) {
					var cw models.ClientWebsite
					if wCursor.Decode(&cw) == nil {
						websiteNames[cw.ID] = cw.Name
					}
				}
			}
		}
		for _, ct := range clientTasks {
			if name, ok := clientNames[ct.ClientID]; ok {
				taskProjects[ct.ID] = name
			}
			if site, ok := websiteNames[ct.WebsiteID]; ok {
				taskWebsites[ct.ID] = site
			}
		}
	}

	for i := range entries {
		tID := entries[i].TaskID
		if title, ok := taskTitles[tID]; ok && title != "" {
			entries[i].TaskTitle = title
		} else if strings.TrimSpace(entries[i].Note) != "" {
			entries[i].TaskTitle = entries[i].Note
		} else {
			entries[i].TaskTitle = "Unassigned task"
		}
		if proj, ok := taskProjects[tID]; ok {
			entries[i].ProjectName = proj
		}
		if site, ok := taskWebsites[tID]; ok {
			entries[i].WebsiteName = site
		}
	}
}

func (s *Server) resolveHourlyRates(team models.Team, usersMap map[string]gin.H) map[string]float64 {
	rates := make(map[string]float64)
	for uIDHex, uInfo := range usersMap {
		if team.MemberHourlyRates != nil {
			if teamRate, ok := team.MemberHourlyRates[uIDHex]; ok && teamRate >= 0 {
				rates[uIDHex] = teamRate
				uInfo["hourly_rate"] = teamRate
				continue
			}
		}
		if uRate, ok := uInfo["hourly_rate"].(float64); ok && uRate > 0 {
			rates[uIDHex] = uRate
		} else {
			rates[uIDHex] = 0.0
			uInfo["hourly_rate"] = 0.0
		}
	}
	return rates
}

func (s *Server) timeEntryFilter(c *gin.Context, userCtx middleware.UserContext) bson.M {
	filter := bson.M{}
	if userCtx.Role == models.RoleOwnerAdmin {
		if teamIDRaw := strings.TrimSpace(c.Query("team_id")); teamIDRaw != "" {
			if teamID, err := objectIDFromString(teamIDRaw); err == nil {
				filter["team_id"] = teamID
			}
		} else if !userCtx.TeamID.IsZero() {
			filter["team_id"] = userCtx.TeamID
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
			if teamID, _, ok := s.resolveTimerTask(c, taskID, userCtx); ok {
				filter["task_id"] = taskID
				filter["team_id"] = teamID
			} else {
				filter["task_id"] = primitive.NewObjectID()
			}
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
	if paidParam := strings.TrimSpace(c.Query("paid")); paidParam != "" {
		if paidParam == "true" || paidParam == "1" {
			filter["paid"] = true
		} else if paidParam == "false" || paidParam == "0" {
			filter["paid"] = bson.M{"$ne": true}
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
