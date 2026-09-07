package handlers

import (
	"context"
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestInvitationAccessFilterStaysWithinTeamAndSelection(t *testing.T) {
	team, domain := primitive.NewObjectID(), primitive.NewObjectID()
	filter := invitationAccessFilter(team, []primitive.ObjectID{domain, domain})
	want := bson.M{"team_id": team, "_id": bson.M{"$in": []primitive.ObjectID{domain}}}
	if !reflect.DeepEqual(filter, want) {
		t.Fatalf("access filter must constrain team and selected IDs: %#v", filter)
	}
}

func TestInvitationAccessRejectsInvalidSelections(t *testing.T) {
	s := &Server{}
	ctx := context.Background()
	team := primitive.NewObjectID()
	if err := s.validateInvitationAccess(ctx, team, nil, nil); err != nil {
		t.Fatal("staff can be invited without project access", err)
	}
	if err := s.validateInvitationAccess(ctx, team, make([]primitive.ObjectID, 501), nil); err == nil {
		t.Fatal("oversized selection accepted")
	}
	if err := s.validateInvitationAccess(ctx, team, nil, []primitive.ObjectID{primitive.NilObjectID}); err == nil {
		t.Fatal("zero domain ID accepted")
	}
}
