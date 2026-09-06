package handlers

import (
	"reflect"
	"testing"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestOwnerWorkspaceProjectsUseOwnerIdentity(t *testing.T) {
	owner := primitive.NewObjectID()
	otherOwner := primitive.NewObjectID()
	for _, team := range []primitive.ObjectID{primitive.NilObjectID, primitive.NewObjectID()} {
		filter := ownerWorkspaceProjectFilter(middleware.UserContext{ID: owner, Role: models.RoleOwnerAdmin, TeamID: team})
		if !reflect.DeepEqual(filter, bson.M{"created_by": owner}) {
			t.Fatalf("owner workspace must select its own projects, regardless of team context: %v", filter)
		}
		other := ownerWorkspaceProjectFilter(middleware.UserContext{ID: otherOwner, Role: models.RoleOwnerAdmin, TeamID: team})
		if reflect.DeepEqual(filter, other) {
			t.Fatal("different platform owners share the same personal project list")
		}
	}
}

func TestOtherProjectRolesKeepExistingAccessFilters(t *testing.T) {
	for _, role := range []models.Role{models.RoleTeamAdmin, models.RoleMember, models.RoleClientAdmin} {
		filter := ownerWorkspaceProjectFilter(middleware.UserContext{ID: primitive.NewObjectID(), Role: role})
		if len(filter) != 0 {
			t.Fatalf("%s must retain the existing team and invitation filters", role)
		}
	}
}
