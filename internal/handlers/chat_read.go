package handlers

import (
	"bugmark/internal/models"
	"context"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"net/http"
)

func chatHiddenUpdate(user primitive.ObjectID, hide bool) bson.M {
	if hide {
		return bson.M{"$addToSet": bson.M{"hidden_for": user}}
	}
	return bson.M{"$pull": bson.M{"hidden_for": user}}
}

func (s *Server) setChatHidden(c *gin.Context, hide bool) {
	user, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok || !s.userCanAccessChat(c, user, id) {
		return
	}
	if _, err := s.store.C("chats").UpdateByID(c.Request.Context(), id, chatHiddenUpdate(user.ID, hide)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update your chat list"})
		return
	}
	// No shared deletion, message removal or broadcast to other participants.
	c.JSON(http.StatusOK, gin.H{"deleted": hide, "account_only": true})
}

func unreadChatFilter(user primitive.ObjectID, chats []primitive.ObjectID) bson.M {
	return bson.M{"chat_id": bson.M{"$in": chats}, "sender_id": bson.M{"$ne": user}, "read_by": bson.M{"$ne": user}}
}

func (s *Server) populateChatUnread(ctx context.Context, chats []models.Chat, user primitive.ObjectID) error {
	if len(chats) == 0 {
		return nil
	}
	ids := make([]primitive.ObjectID, 0, len(chats))
	for _, chat := range chats {
		ids = append(ids, chat.ID)
	}
	cursor, err := s.store.C("messages").Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: unreadChatFilter(user, ids)}},
		bson.D{{Key: "$group", Value: bson.M{"_id": "$chat_id", "count": bson.M{"$sum": 1}}}},
	})
	if err != nil {
		return err
	}
	var rows []struct {
		ID    primitive.ObjectID `bson:"_id"`
		Count int64              `bson:"count"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return err
	}
	counts := map[primitive.ObjectID]int64{}
	for _, row := range rows {
		counts[row.ID] = row.Count
	}
	for i := range chats {
		chats[i].UnreadCount = counts[chats[i].ID]
	}
	return nil
}

func (s *Server) markChatRead(c *gin.Context) {
	user, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok || !s.userCanAccessChat(c, user, id) {
		return
	}
	var req struct {
		MessageIDs []primitive.ObjectID `json:"message_ids"`
	}
	if c.ShouldBindJSON(&req) != nil || len(req.MessageIDs) == 0 || len(req.MessageIDs) > 250 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide 1–250 displayed message IDs"})
		return
	}
	// Read through the newest displayed message, including earlier history.
	// Messages arriving after it must remain unread, even during this request.
	var latest models.Message
	if err := s.store.C("messages").FindOne(c.Request.Context(), bson.M{"chat_id": id, "_id": bson.M{"$in": req.MessageIDs}}, options.FindOne().SetSort(bson.D{{Key: "sent_at", Value: -1}, {Key: "_id", Value: -1}})).Decode(&latest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "displayed messages not found in this chat"})
		return
	}
	filter := readChatThroughFilter(user.ID, id, latest)
	result, err := s.store.C("messages").UpdateMany(c.Request.Context(), filter, bson.M{"$addToSet": bson.M{"read_by": user.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not mark messages read"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": result.ModifiedCount})
}

func readChatThroughFilter(user, chat primitive.ObjectID, latest models.Message) bson.M {
	filter := unreadChatFilter(user, []primitive.ObjectID{chat})
	filter["$or"] = bson.A{
		bson.M{"sent_at": bson.M{"$lt": latest.SentAt}},
		bson.M{"sent_at": latest.SentAt, "_id": bson.M{"$lte": latest.ID}},
	}
	return filter
}
