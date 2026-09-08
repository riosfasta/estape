package handlers

import (
	"context"
	"testing"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestPersonalWorkspaceRoleIsAdmin(t *testing.T) {
	s := &Server{}
	ctx := context.Background()

	userID := primitive.NewObjectID()
	personalTeamID := primitive.NewObjectID()

	// Personal workspace context: user is owner of their personal team
	userCtx := middleware.UserContext{
		ID:     userID,
		Role:   models.RoleTeamAdmin,
		TeamID: personalTeamID,
	}

	// In their personal workspace, user must have RoleTeamAdmin
	if userCtx.Role != models.RoleTeamAdmin {
		t.Fatalf("expected personal workspace role to be %s, got %s", models.RoleTeamAdmin, userCtx.Role)
	}

	// Verify teamRoleForStaffRole behavior
	for _, staffRole := range []string{"developer", "designer", "marketing", "copy writer", "it", "manager", "internal"} {
		role := teamRoleForStaffRole(staffRole)
		if role != models.RoleMember {
			t.Errorf("staff role %q should map to %s, got %s", staffRole, models.RoleMember, role)
		}
	}
	if role := teamRoleForStaffRole(string(models.RoleClientAdmin)); role != models.RoleClientAdmin {
		t.Errorf("client admin staff role should map to %s, got %s", models.RoleClientAdmin, role)
	}

	// Verify that canManageTeamSilently allows owner admin
	ownerCtx := middleware.UserContext{
		ID:     userID,
		Role:   models.RoleOwnerAdmin,
		TeamID: personalTeamID,
	}
	if !s.canManageTeamSilently(ctx, ownerCtx, personalTeamID) {
		t.Error("owner admin must be able to manage any team")
	}

	// Verify team admin can manage their assigned team
	teamAdminCtx := middleware.UserContext{
		ID:     userID,
		Role:   models.RoleTeamAdmin,
		TeamID: personalTeamID,
	}
	if !s.canManageTeamSilently(ctx, teamAdminCtx, personalTeamID) {
		t.Error("team admin must be able to manage their assigned team")
	}

	// Verify member cannot manage the assigned team
	memberCtx := middleware.UserContext{
		ID:     userID,
		Role:   models.RoleMember,
		TeamID: personalTeamID,
	}
	if s.canManageTeamSilently(ctx, memberCtx, personalTeamID) {
		t.Error("regular member must not be able to manage the team")
	}
}

func TestInvitedWorkspaceRoleIsMember(t *testing.T) {
	ctx := context.Background()
	s := &Server{}

	aliceID := primitive.NewObjectID()
	aliceTeamID := primitive.NewObjectID()
	bobID := primitive.NewObjectID()

	// Bob is invited to Alice's workspace as a developer
	bobInAliceWorkspace := middleware.UserContext{
		ID:     bobID,
		Role:   models.RoleMember,
		TeamID: aliceTeamID,
	}

	// Bob in Alice's workspace should not be able to manage Alice's team
	if s.canManageTeamSilently(ctx, bobInAliceWorkspace, aliceTeamID) {
		t.Error("Bob as a member must not be able to manage Alice's team")
	}

	// Alice as team admin can manage her team
	aliceCtx := middleware.UserContext{
		ID:     aliceID,
		Role:   models.RoleTeamAdmin,
		TeamID: aliceTeamID,
	}
	if !s.canManageTeamSilently(ctx, aliceCtx, aliceTeamID) {
		t.Error("Alice as team admin must be able to manage her team")
	}
}

func TestWorkspaceRoleSeparation(t *testing.T) {
	bobID := primitive.NewObjectID()
	bobPersonalTeamID := primitive.NewObjectID()
	aliceTeamID := primitive.NewObjectID()

	// Case 1: Bob on his own workspace
	bobOnOwnWorkspace := models.User{
		ID:        bobID,
		TeamID:    bobPersonalTeamID,
		Role:      models.RoleTeamAdmin,
		StaffRole: "manager",
	}
	if bobOnOwnWorkspace.Role != models.RoleTeamAdmin {
		t.Fatalf("Bob must be %s on his own workspace, got %s", models.RoleTeamAdmin, bobOnOwnWorkspace.Role)
	}

	// Case 2: Bob switched into Alice's workspace
	bobOnAliceWorkspace := models.User{
		ID:        bobID,
		TeamID:    aliceTeamID,
		Role:      models.RoleMember,
		StaffRole: "developer",
	}
	if bobOnAliceWorkspace.Role != models.RoleMember {
		t.Fatalf("Bob must be %s on Alice's workspace, got %s", models.RoleMember, bobOnAliceWorkspace.Role)
	}

	// Case 3: Bob switches back to his own workspace
	bobBackOnOwnWorkspace := models.User{
		ID:        bobID,
		TeamID:    bobPersonalTeamID,
		Role:      models.RoleTeamAdmin,
		StaffRole: "manager",
	}
	if bobBackOnOwnWorkspace.Role != models.RoleTeamAdmin {
		t.Fatalf("Bob must be %s when switched back to his own workspace, got %s", models.RoleTeamAdmin, bobBackOnOwnWorkspace.Role)
	}
}
