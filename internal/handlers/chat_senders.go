package handlers

import (
	"context"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func chatSenderIdentity(user models.User, profile models.FreelancerProfile) models.ChatSender {
	name := firstNonEmpty(profile.Name, user.Name, user.Username, "Chat member")
	if user.Role == models.RoleOwnerAdmin {
		name = "Bug Mega"
	}
	return models.ChatSender{ID: user.ID, Name: name, AvatarURL: firstNonEmpty(profile.Photo, user.AvatarURL), Role: user.Role}
}

// Called only after the conversation access check. Return presentation fields,
// never emails, identity documents or other private account/profile data.
func (s *Server) chatSenders(ctx context.Context, ids []primitive.ObjectID) (map[primitive.ObjectID]*models.ChatSender, error) {
	out := map[primitive.ObjectID]*models.ChatSender{}
	ids = uniqueObjectIDs(ids)
	if len(ids) == 0 {
		return out, nil
	}
	filter := bson.M{"_id": bson.M{"$in": ids}}
	cursor, err := s.store.C("users").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1, "name": 1, "username": 1, "avatar_url": 1, "role": 1}))
	if err != nil {
		return nil, err
	}
	var users []models.User
	if err := cursor.All(ctx, &users); err != nil {
		return nil, err
	}
	profiles, err := s.store.C("freelancer_profiles").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1, "name": 1, "photo": 1}))
	if err != nil {
		return nil, err
	}
	var rows []models.FreelancerProfile
	if err := profiles.All(ctx, &rows); err != nil {
		return nil, err
	}
	byID := map[primitive.ObjectID]models.FreelancerProfile{}
	for _, profile := range rows {
		byID[profile.ID] = profile
	}
	for _, user := range users {
		identity := chatSenderIdentity(user, byID[user.ID])
		out[user.ID] = &identity
	}
	return out, nil
}
