package handlers

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// Serialize group edits and their effective-access refresh in this server.
var teamGroupMu sync.Mutex

func (s *Server) managedGroupTeam(c *gin.Context) (models.Team, bool) {
	var team models.Team
	id, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, id) || !s.canManageTeam(c, id) {
		return team, false
	}
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return team, false
	}
	actor, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), actor.ID)
	if err != nil || user.Status != models.StatusActive || !(user.Role == models.RoleOwnerAdmin || team.OwnerAdminID == user.ID || (user.Role == models.RoleTeamAdmin && user.TeamID == id)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only active company admins can manage groups and access"})
		return team, false
	}
	return team, true
}

func (s *Server) saveTeamGroup(c *gin.Context) {
	teamGroupMu.Lock()
	defer teamGroupMu.Unlock()
	team, ok := s.managedGroupTeam(c)
	if !ok {
		return
	}
	var group models.TeamGroup
	if c.ShouldBindJSON(&group) != nil || len(strings.TrimSpace(group.Name)) == 0 || len(group.Name) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a group name of 1–80 characters"})
		return
	}
	group.Name = strings.TrimSpace(group.Name)
	if err := s.validateInvitationAccess(c.Request.Context(), team.ID, group.ClientIDs, group.WebsiteIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	index := -1
	if c.Param("groupId") != "" {
		id, valid := objectIDParam(c, "groupId")
		if !valid {
			return
		}
		for i, existing := range team.Groups {
			if existing.ID == id {
				index = i
			}
		}
		if index < 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
			return
		}
		group.ID = id
	} else {
		if len(team.Groups) >= 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "a team can have up to 100 groups"})
			return
		}
		group.ID = primitive.NewObjectID()
	}
	for _, existing := range team.Groups {
		if existing.ID != group.ID && strings.EqualFold(existing.Name, group.Name) {
			c.JSON(http.StatusConflict, gin.H{"error": "a group with this name already exists"})
			return
		}
	}
	if index < 0 {
		team.Groups = append(team.Groups, group)
	} else {
		team.Groups[index] = group
	}
	s.persistTeamGroups(c, team)
}

func (s *Server) deleteTeamGroup(c *gin.Context) {
	teamGroupMu.Lock()
	defer teamGroupMu.Unlock()
	team, ok := s.managedGroupTeam(c)
	if !ok {
		return
	}
	id, ok := objectIDParam(c, "groupId")
	if !ok {
		return
	}
	found := false
	groups := []models.TeamGroup{}
	for _, group := range team.Groups {
		if group.ID == id {
			found = true
		} else {
			groups = append(groups, group)
		}
	}
	if !found {
		s.persistTeamGroups(c, team)
		return
	}
	team.Groups = groups
	for user, group := range team.MemberGroups {
		if group == id.Hex() {
			delete(team.MemberGroups, user)
		}
	}
	s.persistTeamGroups(c, team)
}

func (s *Server) groupMember(c *gin.Context, team models.Team) (primitive.ObjectID, bool) {
	id, ok := objectIDParam(c, "userId")
	if !ok {
		return id, false
	}
	var member models.User
	if s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&member) != nil ||
		!containsObjectID(team.MemberIDs, id) || member.Status != models.StatusActive ||
		id == team.OwnerAdminID || member.Role == models.RoleOwnerAdmin || (member.Role == models.RoleTeamAdmin && member.TeamID == team.ID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select an active staff member of this team; company admins retain full access"})
		return id, false
	}
	return id, true
}

func (s *Server) moveTeamGroupMember(c *gin.Context) {
	teamGroupMu.Lock()
	defer teamGroupMu.Unlock()
	team, ok := s.managedGroupTeam(c)
	if !ok {
		return
	}
	member, ok := s.groupMember(c, team)
	if !ok {
		return
	}
	var req struct {
		GroupID string `json:"group_id"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group selection"})
		return
	}
	found := req.GroupID == ""
	for _, group := range team.Groups {
		if group.ID.Hex() == req.GroupID {
			found = true
		}
	}
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group does not belong to this team"})
		return
	}
	if team.MemberGroups == nil {
		team.MemberGroups = map[string]string{}
	}
	if req.GroupID == "" {
		delete(team.MemberGroups, member.Hex())
	} else {
		team.MemberGroups[member.Hex()] = req.GroupID
	}
	s.persistTeamGroups(c, team)
}

func (s *Server) persistTeamGroups(c *gin.Context, team models.Team) {
	if team.Groups == nil {
		team.Groups = []models.TeamGroup{}
	}
	if team.MemberGroups == nil {
		team.MemberGroups = map[string]string{}
	}
	if _, err := s.store.C("teams").UpdateByID(c.Request.Context(), team.ID, bson.M{"$set": bson.M{"groups": team.Groups, "member_groups": team.MemberGroups}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save team groups"})
		return
	}
	if err := s.syncTeamGroupAccess(c.Request.Context(), team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "group saved but access could not be fully updated; save again to retry"})
		return
	}
	user, _ := currentUser(c)
	s.audit(c.Request.Context(), user.ID, "team.groups.updated", "team", team.ID)
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

// Keep inherited and directly assigned membership distinct. Existing member_ids
// are direct by default, so no migration or removal of existing grants is needed.
func groupAccessUpdate(inherited []primitive.ObjectID) mongo.Pipeline {
	if inherited == nil {
		inherited = []primitive.ObjectID{}
	}
	direct := bson.M{"$setDifference": bson.A{
		bson.M{"$ifNull": bson.A{"$member_ids", bson.A{}}},
		bson.M{"$ifNull": bson.A{"$group_only_member_ids", bson.A{}}},
	}}
	return mongo.Pipeline{bson.D{{Key: "$set", Value: bson.M{
		"member_ids":            bson.M{"$setUnion": bson.A{direct, inherited}},
		"group_member_ids":      inherited,
		"group_only_member_ids": bson.M{"$setDifference": bson.A{inherited, direct}},
	}}}}
}

func groupMembersForResource(team models.Team, id primitive.ObjectID, website bool, active map[primitive.ObjectID]bool) []primitive.ObjectID {
	members := []primitive.ObjectID{}
	for _, group := range team.Groups {
		ids := group.ClientIDs
		if website {
			ids = group.WebsiteIDs
		}
		if !containsObjectID(ids, id) {
			continue
		}
		for _, member := range team.MemberIDs {
			if active[member] && team.MemberGroups[member.Hex()] == group.ID.Hex() {
				members = append(members, member)
			}
		}
	}
	return uniqueObjectIDs(members)
}

func (s *Server) syncTeamGroupAccess(ctx context.Context, team models.Team) error {
	if team.MemberIDs == nil {
		team.MemberIDs = []primitive.ObjectID{}
	}
	active := map[primitive.ObjectID]bool{}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": team.MemberIDs}, "status": models.StatusActive})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var user models.User
		if err := cursor.Decode(&user); err != nil {
			return err
		}
		active[user.ID] = true
	}
	if err := cursor.Err(); err != nil {
		return err
	}
	for _, collection := range []string{"client_projects", "client_websites"} {
		resources, err := s.store.C(collection).Find(ctx, bson.M{"team_id": team.ID})
		if err != nil {
			return err
		}
		var rows []struct {
			ID primitive.ObjectID `bson:"_id"`
		}
		err = resources.All(ctx, &rows)
		resources.Close(ctx)
		if err != nil {
			return err
		}
		for _, row := range rows {
			ids := groupMembersForResource(team, row.ID, collection == "client_websites", active)
			if _, err := s.store.C(collection).UpdateOne(ctx, bson.M{"_id": row.ID, "team_id": team.ID}, groupAccessUpdate(ids)); err != nil {
				return err
			}
		}
	}
	return nil
}

func directMemberAccessUpdate(user primitive.ObjectID, grant bool) mongo.Pipeline {
	members := bson.M{"$ifNull": bson.A{"$member_ids", bson.A{}}}
	only := bson.M{"$ifNull": bson.A{"$group_only_member_ids", bson.A{}}}
	group := bson.M{"$ifNull": bson.A{"$group_member_ids", bson.A{}}}
	if grant {
		return mongo.Pipeline{bson.D{{Key: "$set", Value: bson.M{
			"updated_at":            time.Now(),
			"member_ids":            bson.M{"$setUnion": bson.A{members, bson.A{user}}},
			"group_only_member_ids": bson.M{"$setDifference": bson.A{only, bson.A{user}}},
		}}}}
	}
	return mongo.Pipeline{bson.D{{Key: "$set", Value: bson.M{
		"updated_at":            time.Now(),
		"member_ids":            bson.M{"$setUnion": bson.A{bson.M{"$setDifference": bson.A{members, bson.A{user}}}, group}},
		"client_admin_ids":      bson.M{"$setDifference": bson.A{bson.M{"$ifNull": bson.A{"$client_admin_ids", bson.A{}}}, bson.A{user}}},
		"group_only_member_ids": bson.M{"$setUnion": bson.A{only, bson.M{"$setIntersection": bson.A{group, bson.A{user}}}}},
	}}}, bson.D{{Key: "$unset", Value: clientAccessRoleField(user)}}}
}

func (s *Server) refreshTeamGroupAccess(ctx context.Context, teamID primitive.ObjectID) error {
	teamGroupMu.Lock()
	defer teamGroupMu.Unlock()
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": teamID}).Decode(&team); err != nil {
		return err
	}
	return s.syncTeamGroupAccess(ctx, team)
}

func (s *Server) setTeamMemberAccess(c *gin.Context) {
	teamGroupMu.Lock()
	defer teamGroupMu.Unlock()
	team, ok := s.managedGroupTeam(c)
	if !ok {
		return
	}
	member, ok := s.groupMember(c, team)
	if !ok {
		return
	}
	var req struct {
		ClientIDs  []primitive.ObjectID `json:"client_ids"`
		WebsiteIDs []primitive.ObjectID `json:"website_ids"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid access selection"})
		return
	}
	if err := s.validateInvitationAccess(c.Request.Context(), team.ID, req.ClientIDs, req.WebsiteIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for collection, ids := range map[string][]primitive.ObjectID{"client_projects": req.ClientIDs, "client_websites": req.WebsiteIDs} {
		if ids == nil {
			ids = []primitive.ObjectID{}
		}
		if _, err := s.store.C(collection).UpdateMany(c.Request.Context(), bson.M{"team_id": team.ID, "_id": bson.M{"$in": ids}}, directMemberAccessUpdate(member, true)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update access; please retry"})
			return
		}
		// Resource creators retain their intrinsic access.
		if _, err := s.store.C(collection).UpdateMany(c.Request.Context(), bson.M{"team_id": team.ID, "_id": bson.M{"$nin": ids}, "created_by": bson.M{"$ne": member}}, directMemberAccessUpdate(member, false)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update access; please retry"})
			return
		}
	}
	user, _ := currentUser(c)
	s.audit(c.Request.Context(), user.ID, "team.member.access.updated", "user", member)
	c.JSON(http.StatusOK, gin.H{"saved": true})
}
