package handlers

import (
	"testing"

	"bugmark/internal/models"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestTeamSeatCountIncludesOwnerAndDeduplicatesMembers(t *testing.T) {
	owner := primitive.NewObjectID()
	member := primitive.NewObjectID()
	team := models.Team{OwnerAdminID: owner, MemberIDs: []primitive.ObjectID{owner, member, member, primitive.NilObjectID}}
	if got := teamSeatCount(team); got != 2 {
		t.Fatalf("teamSeatCount() = %d, want 2", got)
	}
}

func TestTeamSeatCountIncludesLegacyOwnerMissingFromMembers(t *testing.T) {
	team := models.Team{OwnerAdminID: primitive.NewObjectID(), MemberIDs: []primitive.ObjectID{primitive.NewObjectID()}}
	if got := teamSeatCount(team); got != 2 {
		t.Fatalf("teamSeatCount() = %d, want 2", got)
	}
}
