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

func chatListIdentity(chat models.Chat, viewer primitive.ObjectID, viewerRole models.Role, people map[primitive.ObjectID]*models.ChatSender, company models.Team) *models.ChatListProfile {
	if chat.Type != "support" && (chat.Type != "direct" || len(chat.ParticipantIDs) > 2) {
		return &models.ChatListProfile{Name: firstNonEmpty(company.Name, "Group chat"), AvatarURL: company.LogoURL, Subtitle: firstNonEmpty(chat.Title, "Group conversation")}
	}
	var person *models.ChatSender
	if chat.Type == "support" && viewerRole == models.RoleOwnerAdmin {
		person = people[chat.CreatedBy]
	} else {
		for _, id := range chat.ParticipantIDs {
			if id == viewer {
				continue
			}
			candidate := people[id]
			if candidate == nil {
				continue
			}
			if person == nil {
				person = candidate
			}
			if chat.Type == "support" && candidate.Role == models.RoleOwnerAdmin {
				person = candidate
				break
			}
		}
	}
	if person == nil {
		return &models.ChatListProfile{Name: "Chat member", Subtitle: "Conversation"}
	}
	subtitle := "Conversation"
	if person.Role == models.RoleOwnerAdmin {
		subtitle = "Admin Support"
	} else if chat.Type == "support" {
		subtitle = "Support conversation"
	}
	return &models.ChatListProfile{Name: person.Name, AvatarURL: person.AvatarURL, Subtitle: subtitle}
}

func (s *Server) populateChatListProfiles(ctx context.Context, chats []models.Chat, viewer primitive.ObjectID, role models.Role) error {
	if len(chats) == 0 {
		return nil
	}
	ids, teamIDs := []primitive.ObjectID{}, []primitive.ObjectID{}
	for _, chat := range chats {
		ids = append(ids, chat.ParticipantIDs...)
		ids = append(ids, chat.CreatedBy)
		teamIDs = append(teamIDs, chat.TeamID)
	}
	people, err := s.chatSenders(ctx, ids)
	if err != nil {
		return err
	}
	companies := map[primitive.ObjectID]models.Team{}
	teamIDs = uniqueObjectIDs(teamIDs)
	if len(teamIDs) > 0 {
		cursor, err := s.store.C("teams").Find(ctx, bson.M{"_id": bson.M{"$in": teamIDs}}, options.Find().SetProjection(bson.M{"_id": 1, "name": 1, "logo_url": 1}))
		if err != nil {
			return err
		}
		var teams []models.Team
		if err := cursor.All(ctx, &teams); err != nil {
			return err
		}
		for _, team := range teams {
			companies[team.ID] = team
		}
	}
	for i := range chats {
		chats[i].ListProfile = chatListIdentity(chats[i], viewer, role, people, companies[chats[i].TeamID])
	}
	return nil
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
