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

func TestAllowedClientTaskAssigneesIncludesMembersAndAdmins(t *testing.T) {
	creator := primitive.NewObjectID()
	member1 := primitive.NewObjectID()
	member2 := primitive.NewObjectID()
	siteCreator := primitive.NewObjectID()
	siteMember := primitive.NewObjectID()
	admin := primitive.NewObjectID()

	client := models.ClientProject{
		CreatedBy:      creator,
		MemberIDs:      []primitive.ObjectID{member1, member2},
		ClientAdminIDs: []primitive.ObjectID{admin},
	}
	site := models.ClientWebsite{
		CreatedBy: siteCreator,
		MemberIDs: []primitive.ObjectID{siteMember},
	}

	allowed := allowedClientTaskAssignees(client, site)
	allowedMap := make(map[primitive.ObjectID]bool)
	for _, id := range allowed {
		allowedMap[id] = true
	}

	for _, expected := range []primitive.ObjectID{creator, member1, member2, admin, siteCreator, siteMember} {
		if !allowedMap[expected] {
			t.Errorf("expected %s to be allowed assignee", expected.Hex())
		}
	}
}

func TestIsFolderMember(t *testing.T) {
	s := &Server{}
	creator := primitive.NewObjectID()
	admin := primitive.NewObjectID()
	invitedMember := primitive.NewObjectID()
	taskOnlyAssignee := primitive.NewObjectID()
	stranger := primitive.NewObjectID()

	client := models.ClientProject{
		CreatedBy:      creator,
		ClientAdminIDs: []primitive.ObjectID{admin},
		MemberIDs:      []primitive.ObjectID{creator, invitedMember, taskOnlyAssignee},
		MemberRoles: map[string]string{
			invitedMember.Hex(): "member",
		},
	}

	if !s.isFolderMember(middleware.UserContext{ID: creator}, client) {
		t.Error("creator must be a folder member")
	}
	if !s.isFolderMember(middleware.UserContext{ID: admin}, client) {
		t.Error("client admin must be a folder member")
	}
	if !s.isFolderMember(middleware.UserContext{ID: invitedMember}, client) {
		t.Error("invited member with role must be a folder member")
	}
	if s.isFolderMember(middleware.UserContext{ID: taskOnlyAssignee}, client) {
		t.Error("task-only assignee without role must NOT be a full folder member")
	}
	if s.isFolderMember(middleware.UserContext{ID: stranger}, client) {
		t.Error("unrelated user must NOT be a folder member")
	}
}

func TestClientAccessSetsOwnerAdmin(t *testing.T) {
	s := &Server{}
	userCtx := middleware.UserContext{
		ID:     primitive.NewObjectID(),
		Role:   models.RoleOwnerAdmin,
		TeamID: primitive.NewObjectID(),
	}
	res := s.clientAccessSets(nil, userCtx)
	if len(res.FullClientIDs) != 0 || len(res.DomainClientIDs) != 0 || len(res.WebsiteIDs) != 0 {
		t.Errorf("expected empty access set for owner_admin, got %+v", res)
	}
}

func TestClientAccessSetsWithNilStore(t *testing.T) {
	s := &Server{}
	userCtx := middleware.UserContext{
		ID:     primitive.NewObjectID(),
		Role:   models.RoleMember,
		TeamID: primitive.NewObjectID(),
	}
	// Calling clientAccessSets with nil store shouldn't panic
	res := s.clientAccessSets(nil, userCtx)
	if len(res.FullClientIDs) != 0 {
		t.Errorf("expected empty access set with nil store, got %+v", res)
	}
}
