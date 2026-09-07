package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestChatSenderIdentity(t *testing.T) {
	user := models.User{ID: primitive.NewObjectID(), Name: "Account name", Username: "user", Email: "private@example.com", AvatarURL: "/uploads/avatar.png", Role: models.RoleOwnerAdmin}
	profile := models.FreelancerProfile{Name: "Profile name", Photo: "/uploads/profile.webp"}
	owner := chatSenderIdentity(user, profile)
	if owner.Name != "Bug Mega" || owner.AvatarURL != profile.Photo {
		t.Fatalf("unexpected owner identity: %+v", owner)
	}
	user.Role = models.RoleMember
	member := chatSenderIdentity(user, profile)
	if member.Name != profile.Name || member.AvatarURL != profile.Photo {
		t.Fatal("profile identity not used")
	}
	fallback := chatSenderIdentity(user, models.FreelancerProfile{})
	if fallback.AvatarURL != user.AvatarURL || fallback.Name != user.Name {
		t.Fatal("account avatar fallback not used")
	}
	raw, _ := json.Marshal(owner)
	if strings.Contains(string(raw), "email") || strings.Contains(string(raw), user.Email) {
		t.Fatal("private data exposed")
	}
	encoded, err := bson.Marshal(models.Message{Sender: &owner})
	if err != nil {
		t.Fatal(err)
	}
	var stored bson.M
	if err := bson.Unmarshal(encoded, &stored); err != nil {
		t.Fatal(err)
	}
	if _, ok := stored["sender"]; ok {
		t.Fatal("sender presentation should not be persisted in messages")
	}
}

func TestChatListIdentityUsesRecipientAndCompany(t *testing.T) {
	owner, customer, colleague := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	people := map[primitive.ObjectID]*models.ChatSender{
		owner:     {ID: owner, Name: "Bug Mega", AvatarURL: "/owner.png", Role: models.RoleOwnerAdmin},
		customer:  {ID: customer, Name: "Alex", AvatarURL: "/alex.png", Role: models.RoleMember},
		colleague: {ID: colleague, Name: "Sam", AvatarURL: "/sam.png", Role: models.RoleMember},
	}
	chat := models.Chat{Type: "support", CreatedBy: customer, ParticipantIDs: []primitive.ObjectID{customer, owner}}
	got := chatListIdentity(chat, owner, models.RoleOwnerAdmin, people, models.Team{})
	if got.Name != "Alex" || got.AvatarURL != "/alex.png" {
		t.Fatalf("owner must see customer: %+v", got)
	}
	got = chatListIdentity(chat, customer, models.RoleMember, people, models.Team{})
	if got.Name != "Bug Mega" || got.Subtitle != "Admin Support" {
		t.Fatalf("customer must see support owner: %+v", got)
	}
	chat.Type = "direct"
	chat.Title = "Old title"
	chat.ParticipantIDs = []primitive.ObjectID{customer, colleague}
	got = chatListIdentity(chat, customer, models.RoleMember, people, models.Team{})
	if got.Name != "Sam" || got.AvatarURL != "/sam.png" {
		t.Fatalf("direct chat must show other person: %+v", got)
	}
	chat.ParticipantIDs = append(chat.ParticipantIDs, owner)
	got = chatListIdentity(chat, customer, models.RoleMember, people, models.Team{Name: "Acme", LogoURL: "/company.png"})
	if got.Name != "Acme" || got.AvatarURL != "/company.png" || got.Subtitle != "Old title" {
		t.Fatalf("group must show company: %+v", got)
	}
}
