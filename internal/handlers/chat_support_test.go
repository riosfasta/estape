package handlers

import (
	"testing"

	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestSupportOwnerNotificationRecipients(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind string
		role models.Role
		want bool
	}{
		{"customer support message", "support", models.RoleMember, true},
		{"company owner support message", "support", models.RoleTeamAdmin, true},
		{"owner reply", "support", models.RoleOwnerAdmin, false},
		{"regular direct message", "direct", models.RoleMember, false},
		{"team message", "team", models.RoleTeamAdmin, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldNotifySupportOwners(models.Chat{Type: tc.kind}, models.User{ID: primitive.NewObjectID(), Role: tc.role})
			if got != tc.want {
				t.Fatalf("notify owner = %v, want %v", got, tc.want)
			}
		})
	}
	if shouldNotifySupportOwners(models.Chat{Type: "support"}, models.User{}) {
		t.Fatal("a missing sender must not trigger a support notification")
	}
}
