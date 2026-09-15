package handlers

import (
	"context"
	"encoding/json"
	"sort"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func continuousChatKey(chatType string, createdBy, teamID primitive.ObjectID, participantIDs []primitive.ObjectID) string {
	switch chatType {
	case "support":
		if !createdBy.IsZero() {
			return "support:" + createdBy.Hex() + ":" + teamID.Hex()
		}
	case "direct":
		ids := uniqueObjectIDs(participantIDs)
		if len(ids) != 2 {
			return ""
		}
		parts := []string{ids[0].Hex(), ids[1].Hex()}
		sort.Strings(parts)
		return "direct:" + parts[0] + ":" + parts[1]
	}
	return ""
}

func isContinuousChat(chat models.Chat) bool {
	return continuousChatKey(chat.Type, chat.CreatedBy, chat.TeamID, chat.ParticipantIDs) != ""
}

func continuousChatFilter(chatType string, createdBy, teamID primitive.ObjectID, participantIDs []primitive.ObjectID, key string) bson.M {
	legacy := bson.M{"type": chatType}
	if chatType == "support" {
		legacy["created_by"] = createdBy
		legacy["team_id"] = teamID
	} else {
		legacy["participant_ids"] = bson.M{"$all": participantIDs, "$size": 2}
	}
	return bson.M{"merged_into": bson.M{"$exists": false}, "$or": bson.A{bson.M{"conversation_key": key}, legacy}}
}

func (s *Server) findContinuousChats(ctx context.Context, chatType string, createdBy, teamID primitive.ObjectID, participantIDs []primitive.ObjectID, key string) ([]models.Chat, error) {
	cursor, err := s.store.C("chats").Find(ctx, continuousChatFilter(chatType, createdBy, teamID, participantIDs, key), options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}, {Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var chats []models.Chat
	if err := cursor.All(ctx, &chats); err != nil {
		return nil, err
	}
	return chats, nil
}

func (s *Server) reuseContinuousChat(ctx context.Context, chatType string, createdBy, teamID primitive.ObjectID, participantIDs []primitive.ObjectID, key string, unhideFor primitive.ObjectID) (models.Chat, bool, error) {
	chats, err := s.findContinuousChats(ctx, chatType, createdBy, teamID, participantIDs, key)
	if err != nil {
		return models.Chat{}, false, err
	}
	if len(chats) == 0 {
		return models.Chat{}, false, nil
	}
	chat, err := s.mergeContinuousChatGroup(ctx, chats, participantIDs, unhideFor)
	return chat, err == nil, err
}

func (s *Server) consolidateContinuousChats(ctx context.Context, chats []models.Chat) ([]models.Chat, error) {
	groups := make(map[string][]models.Chat)
	for _, chat := range chats {
		if key := continuousChatKey(chat.Type, chat.CreatedBy, chat.TeamID, chat.ParticipantIDs); key != "" {
			groups[key] = append(groups[key], chat)
		}
	}

	merged := make(map[string]models.Chat, len(groups))
	for key, group := range groups {
		seed := group[0]
		all, err := s.findContinuousChats(ctx, seed.Type, seed.CreatedBy, seed.TeamID, seed.ParticipantIDs, key)
		if err != nil {
			return nil, err
		}
		if len(all) == 0 {
			continue
		}
		needsUpdate := len(all) > 1
		chat := all[0]
		needsUpdate = needsUpdate || chat.ConversationKey != key || chat.Status != "open" || chat.EndedAt != nil || !chat.EndedBy.IsZero() || chat.DeletedAt != nil || !chat.DeletedBy.IsZero()
		if !needsUpdate {
			merged[key] = chat
			continue
		}
		chat, err = s.mergeContinuousChatGroup(ctx, all, nil, primitive.NilObjectID)
		if err != nil {
			return nil, err
		}
		merged[key] = chat
	}

	result := make([]models.Chat, 0, len(chats))
	seen := make(map[string]bool, len(groups))
	for _, chat := range chats {
		key := continuousChatKey(chat.Type, chat.CreatedBy, chat.TeamID, chat.ParticipantIDs)
		if key == "" {
			result = append(result, chat)
			continue
		}
		if !seen[key] {
			result = append(result, merged[key])
			seen[key] = true
		}
	}
	return result, nil
}

func (s *Server) mergeContinuousChatGroup(ctx context.Context, chats []models.Chat, desiredParticipants []primitive.ObjectID, unhideFor primitive.ObjectID) (models.Chat, error) {
	ordered := append([]models.Chat(nil), chats...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].DeletedAt == nil && ordered[j].DeletedAt != nil {
			return true
		}
		if ordered[i].DeletedAt != nil && ordered[j].DeletedAt == nil {
			return false
		}
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID.Hex() < ordered[j].ID.Hex()
		}
		return ordered[i].CreatedAt.Before(ordered[j].CreatedAt)
	})
	canonical := ordered[0]
	participants := append([]primitive.ObjectID(nil), desiredParticipants...)
	duplicateIDs := make([]primitive.ObjectID, 0, len(ordered)-1)
	for i, chat := range ordered {
		participants = append(participants, chat.ParticipantIDs...)
		if i > 0 {
			duplicateIDs = append(duplicateIDs, chat.ID)
		}
	}
	participants = uniqueObjectIDs(participants)
	key := continuousChatKey(canonical.Type, canonical.CreatedBy, canonical.TeamID, participants)

	if len(duplicateIDs) > 0 {
		if _, err := s.store.C("messages").UpdateMany(ctx, bson.M{"chat_id": bson.M{"$in": duplicateIDs}}, bson.M{"$set": bson.M{"chat_id": canonical.ID}}); err != nil {
			return models.Chat{}, err
		}
		if _, err := s.store.C("notifications").UpdateMany(ctx, bson.M{"related_id": bson.M{"$in": duplicateIDs}}, bson.M{"$set": bson.M{"related_id": canonical.ID}}); err != nil {
			return models.Chat{}, err
		}
		if _, err := s.store.C("chats").UpdateMany(ctx, bson.M{"_id": bson.M{"$in": duplicateIDs}}, bson.M{
			"$set":   bson.M{"merged_into": canonical.ID, "status": "ended"},
			"$unset": bson.M{"conversation_key": ""},
		}); err != nil {
			return models.Chat{}, err
		}
	}

	update := bson.M{
		"$set":   bson.M{"conversation_key": key, "participant_ids": participants, "status": "open"},
		"$unset": bson.M{"ended_at": "", "ended_by": "", "deleted_at": "", "deleted_by": ""},
	}
	if !unhideFor.IsZero() {
		update["$pull"] = bson.M{"hidden_for": unhideFor}
	}
	if _, err := s.store.C("chats").UpdateByID(ctx, canonical.ID, update); err != nil {
		return models.Chat{}, err
	}

	canonical.ConversationKey = key
	canonical.ParticipantIDs = participants
	canonical.Status = "open"
	canonical.EndedAt = nil
	canonical.EndedBy = primitive.NilObjectID
	canonical.DeletedAt = nil
	canonical.DeletedBy = primitive.NilObjectID
	if len(duplicateIDs) > 0 && s.hub != nil {
		for _, duplicateID := range duplicateIDs {
			payload, _ := json.Marshal(gin.H{"type": "chat_merged", "chat_id": duplicateID, "merged_into": canonical.ID})
			s.hub.Broadcast(duplicateID.Hex(), payload)
		}
	}
	return canonical, nil
}
