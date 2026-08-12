package handlers

import (
	"net/http"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func (s *Server) getTeam(c *gin.Context) {
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return
	}
	memberFilter := bson.M{"team_id": teamID}
	if len(team.MemberIDs) > 0 {
		memberFilter = bson.M{"$or": []bson.M{{"team_id": teamID}, {"_id": bson.M{"$in": team.MemberIDs}}}}
	}
	cursor, err := s.store.C("users").Find(c.Request.Context(), memberFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load members"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var members []models.User
	if err := cursor.All(c.Request.Context(), &members); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode members"})
		return
	}
	if members == nil {
		members = []models.User{}
	}
	for i := range members {
		if members[i].ID == team.OwnerAdminID {
			members[i].StaffRole = "owner"
			if members[i].TeamID != teamID && members[i].Role == models.RoleMember {
				members[i].Role = models.RoleTeamAdmin
			}
		}
	}
	seenMembers := make(map[primitive.ObjectID]bool, len(members))
	for _, member := range members {
		seenMembers[member.ID] = true
	}
	leftCursor, err := s.store.C("team_invitations").Find(c.Request.Context(), bson.M{"team_id": teamID, "status": "left"})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load former members"})
		return
	}
	defer leftCursor.Close(c.Request.Context())
	var leftInvitations []models.TeamInvitation
	if err := leftCursor.All(c.Request.Context(), &leftInvitations); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode former members"})
		return
	}
	for _, invitation := range leftInvitations {
		if invitation.ExistingUserID.IsZero() || seenMembers[invitation.ExistingUserID] {
			continue
		}
		var formerMember models.User
		if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": invitation.ExistingUserID}).Decode(&formerMember); err != nil {
			continue
		}
		formerMember.TeamID = teamID
		formerMember.Role = teamRoleForStaffRole(invitation.StaffRole)
		if invitation.StaffRole != "" {
			formerMember.StaffRole = invitation.StaffRole
		}
		formerMember.Status = models.UserStatus("left")
		members = append(members, formerMember)
		seenMembers[formerMember.ID] = true
	}
	c.JSON(http.StatusOK, gin.H{"team": team, "members": members})
}

func (s *Server) updateTeamProfile(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if userCtx.Role != models.RoleTeamAdmin && userCtx.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "only admins can update company profile"})
		return
	}
	if userCtx.Role == models.RoleTeamAdmin && userCtx.TeamID != teamID {
		c.JSON(http.StatusForbidden, gin.H{"error": "team admins can only manage their own team"})
		return
	}
	var req struct {
		Name         string `json:"name"`
		CompanyEmail string `json:"company_email"`
		LogoURL      string `json:"logo_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid company profile body"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.CompanyEmail = strings.ToLower(strings.TrimSpace(req.CompanyEmail))
	req.LogoURL = strings.TrimSpace(req.LogoURL)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "company name is required"})
		return
	}
	set := bson.M{
		"name":          req.Name,
		"company_email": req.CompanyEmail,
		"logo_url":      req.LogoURL,
	}
	if _, err := s.store.C("teams").UpdateByID(c.Request.Context(), teamID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update company profile"})
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID}).Decode(&team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not reload company profile"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "team.profile.updated", "team", teamID)
	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (s *Server) addTeamMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	if !s.requireTeamFeatureAccess(c, teamID, "staff management") {
		return
	}
	var req struct {
		Name      string `json:"name"`
		Email     string `json:"email"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		StaffRole string `json:"staff_role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member body"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and email are required"})
		return
	}
	if req.Password == "" {
		req.Password = "Welcome123!"
	}
	staffRole := allowedStaffRole(req.StaffRole)
	if staffRole == "" {
		staffRole = "internal"
	}
	username, err := s.requestedUsername(c.Request.Context(), req.Username, req.Name, req.Email)
	if err != nil {
		writeUsernameError(c, err)
		return
	}

	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return
	}
	if team.SeatLimitCached > 0 && len(team.MemberIDs) >= team.SeatLimitCached {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "seat limit reached; upgrade your subscription"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not hash password"})
		return
	}
	member := models.User{
		ID:              primitive.NewObjectID(),
		Name:            req.Name,
		Email:           req.Email,
		Username:        username,
		PasswordHash:    hash,
		Role:            teamRoleForStaffRole(staffRole),
		StaffRole:       staffRole,
		TeamID:          teamID,
		Status:          models.StatusActive,
		ThemePreference: "system",
		CreatedAt:       time.Now(),
	}
	if _, err := s.store.C("users").InsertOne(c.Request.Context(), member); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create member"})
		return
	}
	_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), teamID, bson.M{"$addToSet": bson.M{"member_ids": member.ID}})
	s.audit(c.Request.Context(), userCtx.ID, "team.member.added", "user", member.ID)
	c.JSON(http.StatusCreated, gin.H{"member": member, "temporary_password": req.Password})
}

func (s *Server) updateTeamMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	if memberID == userCtx.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot edit your own admin account here"})
		return
	}
	var req struct {
		Name      *string `json:"name"`
		Email     *string `json:"email"`
		Username  *string `json:"username"`
		StaffRole *string `json:"staff_role"`
		Status    *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member update body"})
		return
	}
	set := bson.M{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}
		set["name"] = name
	}
	if req.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*req.Email))
		if email == "" || !strings.Contains(email, "@") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "valid email is required"})
			return
		}
		set["email"] = email
	}
	if req.Username != nil {
		username := normalizeUsername(*req.Username)
		if username == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username must be 3-24 letters, numbers, or underscores"})
			return
		}
		set["username"] = username
	}
	if req.StaffRole != nil {
		staffRole := allowedStaffRole(*req.StaffRole)
		if staffRole == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "choose a valid staff role"})
			return
		}
		set["staff_role"] = staffRole
		set["role"] = teamRoleForStaffRole(staffRole)
	}
	if req.Status != nil {
		switch models.UserStatus(*req.Status) {
		case models.StatusActive, models.StatusSuspended:
			set["status"] = *req.Status
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "status must be active or suspended"})
			return
		}
	}
	if len(set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}
	res, err := s.store.C("users").UpdateOne(c.Request.Context(), bson.M{"_id": memberID, "team_id": teamID, "role": bson.M{"$in": []models.Role{models.RoleMember, models.RoleClientAdmin}}}, bson.M{"$set": set})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already belongs to another user"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update member"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
		return
	}
	if req.Status != nil {
		if models.UserStatus(*req.Status) == models.StatusActive {
			_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), teamID, bson.M{"$addToSet": bson.M{"member_ids": memberID}})
		}
		if models.UserStatus(*req.Status) == models.StatusSuspended {
			_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), teamID, bson.M{"$pull": bson.M{"member_ids": memberID}})
		}
	}
	s.audit(c.Request.Context(), userCtx.ID, "team.member.updated", "user", memberID)
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) removeTeamMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	if memberID == userCtx.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot remove yourself"})
		return
	}
	res, err := s.store.C("users").UpdateOne(c.Request.Context(), bson.M{"_id": memberID, "team_id": teamID, "role": bson.M{"$in": []models.Role{models.RoleMember, models.RoleClientAdmin}}}, bson.M{"$set": bson.M{"status": models.StatusSuspended}})
	if err != nil || res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
		return
	}
	_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), teamID, bson.M{"$pull": bson.M{"member_ids": memberID}})
	_, _ = s.store.C("client_projects").UpdateMany(c.Request.Context(), bson.M{"team_id": teamID}, bson.M{
		"$pull":  bson.M{"member_ids": memberID, "client_admin_ids": memberID},
		"$unset": bson.M{clientAccessRoleField(memberID): ""},
	})
	_, _ = s.store.C("client_websites").UpdateMany(c.Request.Context(), bson.M{"team_id": teamID}, bson.M{
		"$pull":  bson.M{"member_ids": memberID, "client_admin_ids": memberID},
		"$unset": bson.M{clientAccessRoleField(memberID): ""},
	})
	s.audit(c.Request.Context(), userCtx.ID, "team.member.removed", "user", memberID)
	c.JSON(http.StatusOK, gin.H{"removed": true})
}
