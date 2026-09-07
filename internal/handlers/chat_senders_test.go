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
