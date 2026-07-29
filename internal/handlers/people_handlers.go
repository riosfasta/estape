package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var mentionPattern = regexp.MustCompile(`@([A-Za-z0-9_]{3,24})`)

var (
	errInvalidUsername = errors.New("username must be 3-24 letters, numbers, or underscores")
	errUsernameExists  = errors.New("username already exists")
)

func allowedStaffRole(role string) string {
	role = strings.ToLower(strings.TrimSpace(role))
	switch role {
	case "owner", "web developer", "internal", "copy writer", "marketing", "it", "manager":
		return role
	case "client admin", "client_admin", "client-admin":
		return string(models.RoleClientAdmin)
	default:
		return ""
	}
}

func staffRoleDisplayName(role string) string {
	switch allowedStaffRole(role) {
	case "owner":
		return "Owner"
	case "web developer":
		return "Web developer"
	case "internal":
		return "Internal"
	case "copy writer":
		return "Copy writer"
	case "marketing":
		return "Marketing"
	case "it":
		return "IT"
	case "manager":
		return "Manager"
	case string(models.RoleClientAdmin):
		return "Client Admin"
	default:
		return strings.TrimSpace(role)
	}
}

func teamRoleForStaffRole(staffRole string) models.Role {
	if allowedStaffRole(staffRole) == string(models.RoleClientAdmin) {
		return models.RoleClientAdmin
	}
	return models.RoleMember
}

func isInvitedCompanyRole(role models.Role) bool {
	return role == models.RoleMember || role == models.RoleClientAdmin
}

func normalizeUsername(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case r == '_' || r == '-' || r == '.' || r == ' ':
			if !lastUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	out := strings.Trim(b.String(), "_")
	if len(out) > 24 {
		out = strings.Trim(out[:24], "_")
	}
	if len(out) < 3 {
		return ""
	}
	return out
}

func (s *Server) uniqueUsername(ctx context.Context, desired string, fallback string) (string, error) {
	base := normalizeUsername(desired)
	if base == "" {
		base = normalizeUsername(fallback)
	}
	if base == "" {
		base = "user"
	}
	for i := 0; i < 200; i++ {
		candidate := base
		if i > 0 {
			suffix := "_" + strings.TrimLeft(time.Now().Add(time.Duration(i)*time.Millisecond).Format("150405000"), "0")
			if len(candidate)+len(suffix) > 24 {
				candidate = strings.Trim(candidate[:24-len(suffix)], "_")
			}
			candidate += suffix
		}
		count, err := s.store.C("users").CountDocuments(ctx, bson.M{"username": candidate})
		if err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
	}
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	return "user_" + token[:10], nil
}

func (s *Server) requestedUsername(ctx context.Context, requested string, fallbackName string, fallbackEmail string) (string, error) {
	if strings.TrimSpace(requested) == "" {
		return s.uniqueUsername(ctx, fallbackName, fallbackEmail)
	}
	username := normalizeUsername(requested)
	if username == "" {
		return "", errInvalidUsername
	}
	exists, err := s.usernameExists(ctx, username)
	if err != nil {
		return "", err
	}
	if exists {
		return "", errUsernameExists
	}
	return username, nil
}

func (s *Server) usernameExists(ctx context.Context, username string) (bool, error) {
	count, err := s.store.C("users").CountDocuments(ctx, bson.M{"username": username})
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func writeUsernameError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errInvalidUsername):
		c.JSON(http.StatusBadRequest, gin.H{"error": errInvalidUsername.Error()})
	case errors.Is(err, errUsernameExists):
		c.JSON(http.StatusConflict, gin.H{"error": errUsernameExists.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create username"})
	}
}

func (s *Server) ensureUserIdentity(ctx context.Context, user *models.User) {
	set := bson.M{}
	if strings.TrimSpace(user.Username) == "" {
		username, err := s.uniqueUsername(ctx, user.Name, user.Email)
		if err == nil {
			user.Username = username
			set["username"] = username
		}
	}
	if strings.TrimSpace(user.StaffRole) == "" {
		role := "manager"
		if user.Role == models.RoleMember {
			role = "internal"
		} else if user.Role == models.RoleClientAdmin {
			role = string(models.RoleClientAdmin)
		}
		user.StaffRole = role
		set["staff_role"] = role
	}
	if len(set) > 0 {
		_, _ = s.store.C("users").UpdateByID(ctx, user.ID, bson.M{"$set": set})
	}
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *Server) createTeamInvitation(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	if !s.requireTeamFeatureAccess(c, teamID, "staff invitations") {
		return
	}
	var req struct {
		Email     string `json:"email"`
		Username  string `json:"username"`
		StaffRole string `json:"staff_role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invitation body"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid email is required"})
		return
	}
	staffRole := allowedStaffRole(req.StaffRole)
	if staffRole == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "choose a valid staff role"})
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return
	}
	now := time.Now()
	pendingCount, err := s.store.C("team_invitations").CountDocuments(c.Request.Context(), bson.M{
		"team_id":    teamID,
		"email":      email,
		"status":     "pending",
		"expires_at": bson.M{"$gt": now},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check invitation status"})
		return
	}
	if pendingCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "an active invitation already exists for this email"})
		return
	}
	var existing models.User
	existingErr := s.store.C("users").FindOne(c.Request.Context(), bson.M{"email": email}).Decode(&existing)
	existingUserID := primitive.NilObjectID
	username := normalizeUsername(req.Username)
	if existingErr == nil {
		if existing.TeamID == teamID && existing.Status == models.StatusActive {
			c.JSON(http.StatusConflict, gin.H{"error": "this user is already an active member of the team"})
			return
		}
		s.ensureUserIdentity(c.Request.Context(), &existing)
		existingUserID = existing.ID
		username = existing.Username
	} else {
		if existingErr != mongo.ErrNoDocuments {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check existing user"})
			return
		}
		var err error
		username, err = s.requestedUsername(c.Request.Context(), req.Username, email, email)
		if err != nil {
			writeUsernameError(c, err)
			return
		}
	}
	token, err := randomToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create invitation token"})
		return
	}
	invitation := models.TeamInvitation{
		ID:             primitive.NewObjectID(),
		TeamID:         teamID,
		Email:          email,
		Username:       username,
		StaffRole:      staffRole,
		InvitedBy:      userCtx.ID,
		ExistingUserID: existingUserID,
		Token:          token,
		Status:         "pending",
		CreatedAt:      now,
		ExpiresAt:      now.Add(14 * 24 * time.Hour),
	}
	if _, err := s.store.C("team_invitations").InsertOne(c.Request.Context(), invitation); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create invitation"})
		return
	}
	if !existingUserID.IsZero() {
		s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{existingUserID}, userCtx.ID, "team_invitation", "You were invited to join "+team.Name+" as "+staffRoleDisplayName(staffRole)+".", invitation.ID)
		s.enqueueInvitationEmail(c.Request.Context(), email, team.Name, staffRole, s.cfg.AppURL+"/dashboard")
	} else {
		s.enqueueInvitationEmail(c.Request.Context(), email, team.Name, staffRole, s.cfg.AppURL+"/register?invite="+token)
	}
	s.audit(c.Request.Context(), userCtx.ID, "team.invitation.created", "team_invitation", invitation.ID)
	c.JSON(http.StatusCreated, gin.H{"invitation": invitation, "existing_user": existingErr == nil})
}

func (s *Server) listTeamInvitations(c *gin.Context) {
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	cursor, err := s.store.C("team_invitations").Find(c.Request.Context(), bson.M{"team_id": teamID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(100))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load invitations"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var invitations []models.TeamInvitation
	if err := cursor.All(c.Request.Context(), &invitations); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode invitations"})
		return
	}
	if invitations == nil {
		invitations = []models.TeamInvitation{}
	}
	c.JSON(http.StatusOK, gin.H{"invitations": invitations})
}

func (s *Server) cancelTeamInvitation(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	inviteID, ok := objectIDParam(c, "inviteId")
	if !ok {
		return
	}
	now := time.Now()
	res, err := s.store.C("team_invitations").UpdateOne(c.Request.Context(), bson.M{"_id": inviteID, "team_id": teamID, "status": "pending"}, bson.M{"$set": bson.M{"status": "canceled", "responded_at": now}})
	if err != nil || res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pending invitation not found"})
		return
	}
	_, _ = s.store.C("notifications").UpdateMany(c.Request.Context(), bson.M{"related_id": inviteID}, bson.M{"$set": bson.M{"read": true}})
	s.audit(c.Request.Context(), userCtx.ID, "team.invitation.canceled", "team_invitation", inviteID)
	c.JSON(http.StatusOK, gin.H{"canceled": true})
}

func (s *Server) removeTeamInvitation(c *gin.Context) {
	userCtx, _ := currentUser(c)
	teamID, ok := objectIDParam(c, "id")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	if !s.canManageTeam(c, teamID) {
		return
	}
	inviteID, ok := objectIDParam(c, "inviteId")
	if !ok {
		return
	}
	res, err := s.store.C("team_invitations").DeleteOne(c.Request.Context(), bson.M{"_id": inviteID, "team_id": teamID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove invitation"})
		return
	}
	if res.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "invitation not found"})
		return
	}
	_, _ = s.store.C("notifications").DeleteMany(c.Request.Context(), bson.M{"related_id": inviteID})
	s.audit(c.Request.Context(), userCtx.ID, "team.invitation.removed", "team_invitation", inviteID)
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) listMyInvitations(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	filter := bson.M{"status": "pending", "$or": []bson.M{{"existing_user_id": userCtx.ID}, {"email": user.Email}}}
	cursor, err := s.store.C("team_invitations").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(50))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load invitations"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var invitations []models.TeamInvitation
	if err := cursor.All(c.Request.Context(), &invitations); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode invitations"})
		return
	}
	if invitations == nil {
		invitations = []models.TeamInvitation{}
	}
	rows := make([]gin.H, 0, len(invitations))
	for _, invitation := range invitations {
		companyName := ""
		var team models.Team
		if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": invitation.TeamID}).Decode(&team); err == nil {
			companyName = team.Name
		}
		rows = append(rows, gin.H{
			"id":               invitation.ID,
			"team_id":          invitation.TeamID,
			"company_name":     companyName,
			"email":            invitation.Email,
			"username":         invitation.Username,
			"staff_role":       invitation.StaffRole,
			"invited_by":       invitation.InvitedBy,
			"existing_user_id": invitation.ExistingUserID,
			"status":           invitation.Status,
			"created_at":       invitation.CreatedAt,
			"expires_at":       invitation.ExpiresAt,
			"responded_at":     invitation.RespondedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"invitations": rows})
}

func (s *Server) leaveCompany(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if !isInvitedCompanyRole(user.Role) || user.TeamID.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no invited company membership to leave"})
		return
	}
	companyTeamID := user.TeamID
	now := time.Now()
	var company models.Team
	_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": companyTeamID}).Decode(&company)
	personalTeam, err := s.personalTeamForUser(c.Request.Context(), user, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare personal workspace"})
		return
	}
	_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), companyTeamID, bson.M{"$pull": bson.M{"member_ids": user.ID}})
	invitationUpdate, err := s.store.C("team_invitations").UpdateMany(c.Request.Context(), bson.M{
		"team_id":          companyTeamID,
		"existing_user_id": user.ID,
		"status":           "accepted",
	}, bson.M{"$set": bson.M{"status": "left", "responded_at": now}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update company access status"})
		return
	}
	if invitationUpdate.MatchedCount == 0 {
		_, _ = s.store.C("team_invitations").InsertOne(c.Request.Context(), models.TeamInvitation{
			ID:             primitive.NewObjectID(),
			TeamID:         companyTeamID,
			Email:          user.Email,
			Username:       user.Username,
			StaffRole:      user.StaffRole,
			InvitedBy:      company.OwnerAdminID,
			ExistingUserID: user.ID,
			Status:         "left",
			CreatedAt:      now,
			ExpiresAt:      now,
			RespondedAt:    &now,
		})
	}
	update := bson.M{
		"team_id":    personalTeam.ID,
		"role":       models.RoleTeamAdmin,
		"staff_role": "manager",
		"status":     models.StatusActive,
	}
	if _, err := s.store.C("users").UpdateByID(c.Request.Context(), user.ID, bson.M{"$set": update}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not leave company"})
		return
	}
	user.TeamID = personalTeam.ID
	user.Role = models.RoleTeamAdmin
	user.StaffRole = "manager"
	user.Status = models.StatusActive
	if !company.OwnerAdminID.IsZero() && company.OwnerAdminID != user.ID {
		memberName := strings.TrimSpace(user.Name)
		if memberName == "" {
			memberName = user.Email
		}
		companyName := strings.TrimSpace(company.Name)
		if companyName == "" {
			companyName = "your company"
		}
		s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{company.OwnerAdminID}, user.ID, "team_member_left", memberName+" left "+companyName+".", user.ID)
	}
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not refresh session"})
		return
	}
	s.audit(c.Request.Context(), user.ID, "team.member.left", "team", companyTeamID)
	c.JSON(http.StatusOK, gin.H{"left": true, "team": personalTeam, "user": user, "access_token": access, "refresh_token": refresh})
}

func (s *Server) personalTeamForUser(ctx context.Context, user models.User, now time.Time) (models.Team, error) {
	var team models.Team
	err := s.store.C("teams").FindOne(ctx, bson.M{"owner_admin_id": user.ID}).Decode(&team)
	if err == nil {
		return team, nil
	}
	if err != mongo.ErrNoDocuments {
		return models.Team{}, err
	}
	teamID := primitive.NewObjectID()
	subID, plan, err := s.createTrialSubscription(ctx, teamID, now)
	if err != nil {
		return models.Team{}, err
	}
	name := strings.TrimSpace(user.Name)
	if name == "" {
		name = firstNonEmpty(user.Username, user.Email, "Personal")
	}
	team = models.Team{
		ID:              teamID,
		Name:            name + "'s Workspace",
		CompanyEmail:    user.Email,
		OwnerAdminID:    user.ID,
		MemberIDs:       []primitive.ObjectID{user.ID},
		SubscriptionID:  subID,
		SeatLimitCached: plan.SeatLimit,
		CreatedAt:       now,
	}
	if _, err := s.store.C("teams").InsertOne(ctx, team); err != nil {
		return models.Team{}, err
	}
	if err := s.createStarterWorkspace(ctx, teamID, user.ID, now); err != nil {
		return models.Team{}, err
	}
	return team, nil
}

func (s *Server) respondInvitation(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	action := strings.TrimSpace(c.Param("action"))
	if action != "accept" && action != "decline" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invitation action"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	var invitation models.TeamInvitation
	filter := bson.M{"_id": id, "status": "pending", "$or": []bson.M{{"existing_user_id": userCtx.ID}, {"email": user.Email}}}
	if err := s.store.C("team_invitations").FindOne(c.Request.Context(), filter).Decode(&invitation); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invitation not found"})
		return
	}
	now := time.Now()
	status := "declined"
	if action == "accept" {
		status = "accepted"
		username := user.Username
		if username == "" {
			username = invitation.Username
		}
		if username == "" {
			username, err = s.uniqueUsername(c.Request.Context(), user.Name, user.Email)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create username"})
				return
			}
		} else if user.Username == "" {
			username, err = s.uniqueUsername(c.Request.Context(), username, user.Email)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create username"})
				return
			}
		}
		_, err = s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": bson.M{"team_id": invitation.TeamID, "role": teamRoleForStaffRole(invitation.StaffRole), "staff_role": invitation.StaffRole, "username": username, "status": models.StatusActive}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not join team"})
			return
		}
		_, _ = s.store.C("teams").UpdateByID(c.Request.Context(), invitation.TeamID, bson.M{"$addToSet": bson.M{"member_ids": userCtx.ID}})
	}
	_, err = s.store.C("team_invitations").UpdateByID(c.Request.Context(), invitation.ID, bson.M{"$set": bson.M{"status": status, "responded_at": now, "existing_user_id": userCtx.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update invitation"})
		return
	}
	_, _ = s.store.C("notifications").UpdateMany(c.Request.Context(), bson.M{"user_id": userCtx.ID, "related_id": invitation.ID}, bson.M{"$set": bson.M{"read": true}})
	c.JSON(http.StatusOK, gin.H{"status": status})
}

func (s *Server) listMentionUsers(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := bson.M{"status": models.StatusActive}
	mentionTeamID := primitive.NilObjectID
	if strings.TrimSpace(c.Query("team_id")) != "" {
		teamID, err := objectIDFromString(c.Query("team_id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid team_id"})
			return
		}
		if !s.canAccessTeam(c, teamID) {
			return
		}
		mentionTeamID = teamID
	} else if !userCtx.TeamID.IsZero() {
		mentionTeamID = userCtx.TeamID
	} else {
		c.JSON(http.StatusOK, gin.H{"users": []models.User{}})
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": mentionTeamID}).Decode(&team); err == nil && len(team.MemberIDs) > 0 {
		filter["$or"] = []bson.M{{"team_id": mentionTeamID}, {"_id": bson.M{"$in": team.MemberIDs}}}
	} else {
		filter["team_id"] = mentionTeamID
	}
	if q := normalizeUsername(c.Query("q")); q != "" {
		filter["username"] = bson.M{"$regex": "^" + regexp.QuoteMeta(q), "$options": "i"}
	}
	cursor, err := s.store.C("users").Find(c.Request.Context(), filter, options.Find().SetProjection(bson.M{"password_hash": 0, "refresh_token_hash": 0, "two_factor_secret": 0}).SetSort(bson.D{{Key: "username", Value: 1}}).SetLimit(250))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load people"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var users []models.User
	seen := map[primitive.ObjectID]bool{}
	for cursor.Next(c.Request.Context()) {
		var user models.User
		if cursor.Decode(&user) == nil {
			s.ensureUserIdentity(c.Request.Context(), &user)
			seen[user.ID] = true
			users = append(users, user)
		}
	}
	projectRole := models.RoleMember
	if userCtx.Role == models.RoleOwnerAdmin {
		projectRole = models.RoleOwnerAdmin
	} else if team.OwnerAdminID == userCtx.ID || (userCtx.Role == models.RoleTeamAdmin && userCtx.TeamID == mentionTeamID) {
		projectRole = models.RoleTeamAdmin
	} else if userCtx.Role == models.RoleClientAdmin {
		projectRole = models.RoleClientAdmin
	}
	if _, _, clientIDs, err := s.inboxClientProjectContext(c.Request.Context(), userCtx.ID, mentionTeamID, projectRole); err == nil && len(clientIDs) > 0 {
		memberIDs := []primitive.ObjectID{}
		clientCursor, err := s.store.C("client_projects").Find(c.Request.Context(), bson.M{"_id": bson.M{"$in": clientIDs}}, options.Find().SetProjection(bson.M{"member_ids": 1, "client_admin_ids": 1}))
		if err == nil {
			defer clientCursor.Close(c.Request.Context())
			for clientCursor.Next(c.Request.Context()) {
				var client models.ClientProject
				if clientCursor.Decode(&client) == nil {
					memberIDs = append(memberIDs, client.MemberIDs...)
					memberIDs = append(memberIDs, client.ClientAdminIDs...)
				}
			}
		}
		for _, user := range s.usersForIDs(c.Request.Context(), uniqueObjectIDs(memberIDs)) {
			if seen[user.ID] || user.Status != models.StatusActive {
				continue
			}
			s.ensureUserIdentity(c.Request.Context(), &user)
			if q := normalizeUsername(c.Query("q")); q != "" && !strings.HasPrefix(strings.ToLower(user.Username), q) {
				continue
			}
			seen[user.ID] = true
			users = append(users, user)
		}
	}
	if users == nil {
		users = []models.User{}
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (s *Server) listNotifications(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := bson.M{"user_id": userCtx.ID}
	if strings.EqualFold(c.Query("bin"), "1") || strings.EqualFold(c.Query("bin"), "true") {
		filter["deleted_at"] = bson.M{"$exists": true}
	} else {
		filter["deleted_at"] = bson.M{"$exists": false}
	}
	cursor, err := s.store.C("notifications").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(100))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load notifications"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var notifications []models.Notification
	if err := cursor.All(c.Request.Context(), &notifications); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode notifications"})
		return
	}
	if notifications == nil {
		notifications = []models.Notification{}
	}
	c.JSON(http.StatusOK, gin.H{"notifications": notifications})
}

func (s *Server) openMyNotification(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var note models.Notification
	filter := bson.M{"_id": id, "user_id": userCtx.ID, "type": bson.M{"$ne": "team_invitation"}, "deleted_at": bson.M{"$exists": false}}
	if err := s.store.C("notifications").FindOne(c.Request.Context(), filter).Decode(&note); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}
	_, _ = s.store.C("notifications").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"read": true}})
	target := s.notificationTarget(c.Request.Context(), note)
	target["opened"] = true
	target["notification"] = gin.H{
		"id":         note.ID.Hex(),
		"type":       note.Type,
		"content":    note.Content,
		"related_id": note.RelatedID.Hex(),
		"created_at": note.CreatedAt,
	}
	c.JSON(http.StatusOK, target)
}

func (s *Server) notificationTarget(ctx context.Context, note models.Notification) gin.H {
	related := note.RelatedID
	target := gin.H{"url": "/dashboard", "source_type": "notification"}
	switch note.Type {
	case "admin_message", "chat_message", "chat_ended", "support_chat_created":
		if !related.IsZero() {
			target["url"] = "/chat?id=" + related.Hex()
			target["source_type"] = "chat"
			target["chat_id"] = related.Hex()
		}
	case "chat_mention":
		var msg models.Message
		if !related.IsZero() && s.store.C("messages").FindOne(ctx, bson.M{"_id": related}).Decode(&msg) == nil {
			target["url"] = "/chat?id=" + msg.ChatID.Hex()
			target["source_type"] = "chat"
			target["chat_id"] = msg.ChatID.Hex()
			target["message_id"] = related.Hex()
		}
	case "task_assigned", "task_updated", "task_comment", "task_mention":
		if !related.IsZero() {
			target["url"] = "/dashboard?task_id=" + related.Hex() + "&source_type=task"
			target["source_type"] = "task"
			target["task_id"] = related.Hex()
		}
	case "comment_mention":
		if taskTarget, ok := s.taskCommentNotificationTarget(ctx, related); ok {
			return taskTarget
		}
		if feedbackTarget, ok := s.feedbackNotificationTarget(ctx, related); ok {
			return feedbackTarget
		}
	case "client_task_assigned", "client_task_updated", "client_task_mention":
		if !related.IsZero() {
			target["url"] = "/tasks?task_id=" + related.Hex()
			target["source_type"] = "client_task"
			target["task_id"] = related.Hex()
		}
	case "client_task_comment", "client_task_comment_mention", "client_task_comment_reaction":
		if !related.IsZero() {
			var comment models.ClientTaskComment
			if s.store.C("client_task_comments").FindOne(ctx, bson.M{"_id": related}).Decode(&comment) == nil {
				target["url"] = "/tasks?task_id=" + comment.TaskID.Hex() + "&comment_id=" + related.Hex()
				target["source_type"] = "client_task"
				target["task_id"] = comment.TaskID.Hex()
				target["comment_id"] = related.Hex()
			} else {
				target["url"] = "/tasks"
				target["source_type"] = "client_task"
			}
		}
	case "client_project_added", "client_project_role_updated":
		if !related.IsZero() {
			target["url"] = "/projects/" + related.Hex()
			target["source_type"] = "client_project"
			target["client_id"] = related.Hex()
		}
	case "bug_assigned", "feedback_mention":
		if feedbackTarget, ok := s.feedbackNotificationTarget(ctx, related); ok {
			return feedbackTarget
		}
	case "team_member_left":
		target["url"] = "/team"
		target["source_type"] = "team"
	case "membership_updated":
		target["url"] = "/settings/billing"
		target["source_type"] = "billing"
	case "subscription_purchase":
		if !related.IsZero() {
			target["url"] = "/admin/users?subscription_id=" + related.Hex()
			target["source_type"] = "subscription"
			target["subscription_id"] = related.Hex()
		}
	}
	return target
}

func (s *Server) taskCommentNotificationTarget(ctx context.Context, related primitive.ObjectID) (gin.H, bool) {
	if related.IsZero() {
		return nil, false
	}
	var task models.Task
	if s.store.C("tasks").FindOne(ctx, bson.M{"comments.id": related}).Decode(&task) == nil {
		return gin.H{
			"url":         "/dashboard?task_id=" + task.ID.Hex() + "&comment_id=" + related.Hex() + "&source_type=task",
			"source_type": "task",
			"task_id":     task.ID.Hex(),
			"comment_id":  related.Hex(),
		}, true
	}
	if s.store.C("tasks").FindOne(ctx, bson.M{"_id": related}).Decode(&task) == nil {
		return gin.H{
			"url":         "/dashboard?task_id=" + task.ID.Hex() + "&source_type=task",
			"source_type": "task",
			"task_id":     task.ID.Hex(),
		}, true
	}
	return nil, false
}

func (s *Server) feedbackNotificationTarget(ctx context.Context, related primitive.ObjectID) (gin.H, bool) {
	if related.IsZero() {
		return nil, false
	}
	var bug models.Bug
	if s.store.C("bugs").FindOne(ctx, bson.M{"comments.id": related}).Decode(&bug) == nil {
		return gin.H{
			"url":         "/websites/" + bug.WebsiteID.Hex() + "/annotate?bug_id=" + bug.ID.Hex() + "&comment_id=" + related.Hex(),
			"source_type": "feedback",
			"bug_id":      bug.ID.Hex(),
			"comment_id":  related.Hex(),
			"website_id":  bug.WebsiteID.Hex(),
		}, true
	}
	if s.store.C("bugs").FindOne(ctx, bson.M{"_id": related}).Decode(&bug) == nil {
		return gin.H{
			"url":         "/websites/" + bug.WebsiteID.Hex() + "/annotate?bug_id=" + bug.ID.Hex(),
			"source_type": "feedback",
			"bug_id":      bug.ID.Hex(),
			"website_id":  bug.WebsiteID.Hex(),
		}, true
	}
	return nil, false
}

func (s *Server) notifyUserIDs(ctx context.Context, userIDs []primitive.ObjectID, actorID primitive.ObjectID, notificationType string, content string, relatedID primitive.ObjectID) {
	content = strings.TrimSpace(content)
	if content == "" {
		return
	}
	now := time.Now()
	for _, userID := range s.userNotificationRecipients(ctx, userIDs, actorID) {
		s.insertNotification(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    userID,
			Type:      notificationType,
			Content:   trimForNotification(content),
			RelatedID: relatedID,
			Read:      false,
			CreatedAt: now,
		})
	}
}

func (s *Server) notifyOwnerAdmins(ctx context.Context, actorID primitive.ObjectID, notificationType string, content string, relatedID primitive.ObjectID) {
	content = strings.TrimSpace(content)
	if content == "" {
		return
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"role": models.RoleOwnerAdmin, "status": models.StatusActive})
	if err != nil {
		return
	}
	defer cursor.Close(ctx)
	now := time.Now()
	for cursor.Next(ctx) {
		var owner models.User
		if cursor.Decode(&owner) != nil || owner.ID.IsZero() || owner.ID == actorID {
			continue
		}
		s.insertNotification(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    owner.ID,
			Type:      notificationType,
			Content:   trimForNotification(content),
			RelatedID: relatedID,
			Read:      false,
			CreatedAt: now,
		})
	}
}

func (s *Server) userNotificationRecipients(ctx context.Context, userIDs []primitive.ObjectID, actorID primitive.ObjectID) []primitive.ObjectID {
	candidates := []primitive.ObjectID{}
	for _, userID := range uniqueObjectIDs(userIDs) {
		if userID.IsZero() || userID == actorID {
			continue
		}
		candidates = append(candidates, userID)
	}
	if len(candidates) == 0 {
		return nil
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": candidates}, "role": bson.M{"$ne": models.RoleOwnerAdmin}})
	if err != nil {
		return nil
	}
	defer cursor.Close(ctx)
	allowed := map[primitive.ObjectID]bool{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) == nil {
			allowed[user.ID] = true
		}
	}
	recipients := []primitive.ObjectID{}
	for _, userID := range candidates {
		if allowed[userID] {
			recipients = append(recipients, userID)
		}
	}
	return recipients
}

func (s *Server) notificationActorName(ctx context.Context, actorID primitive.ObjectID) string {
	if user, err := s.loadUser(ctx, actorID); err == nil {
		s.ensureUserIdentity(ctx, &user)
		return firstNonEmpty(user.Name, user.Username, user.Email, "Someone")
	}
	return "Someone"
}

func (s *Server) notificationActorMention(ctx context.Context, actorID primitive.ObjectID) string {
	if user, err := s.loadUser(ctx, actorID); err == nil {
		s.ensureUserIdentity(ctx, &user)
		if strings.TrimSpace(user.Username) != "" {
			return "@" + user.Username
		}
		return firstNonEmpty(user.Name, user.Email, "Someone")
	}
	return "Someone"
}

func (s *Server) deleteMyNotifications(c *gin.Context) {
	userCtx, _ := currentUser(c)
	now := time.Now()
	result, err := s.store.C("notifications").UpdateMany(
		c.Request.Context(),
		bson.M{"user_id": userCtx.ID, "type": bson.M{"$ne": "team_invitation"}, "deleted_at": bson.M{"$exists": false}},
		bson.M{"$set": bson.M{"deleted_at": now, "read": true}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not move notifications to bin"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true, "count": result.ModifiedCount})
}

func (s *Server) deleteMyNotification(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	now := time.Now()
	result, err := s.store.C("notifications").UpdateOne(
		c.Request.Context(),
		bson.M{"_id": id, "user_id": userCtx.ID, "type": bson.M{"$ne": "team_invitation"}, "deleted_at": bson.M{"$exists": false}},
		bson.M{"$set": bson.M{"deleted_at": now, "read": true}},
	)
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) restoreMyNotification(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	result, err := s.store.C("notifications").UpdateOne(
		c.Request.Context(),
		bson.M{"_id": id, "user_id": userCtx.ID, "deleted_at": bson.M{"$exists": true}},
		bson.M{"$unset": bson.M{"deleted_at": ""}, "$set": bson.M{"read": false}},
	)
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found in bin"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restored": true})
}

func (s *Server) restoreAllMyNotifications(c *gin.Context) {
	userCtx, _ := currentUser(c)
	result, err := s.store.C("notifications").UpdateMany(
		c.Request.Context(),
		bson.M{"user_id": userCtx.ID, "type": bson.M{"$ne": "team_invitation"}, "deleted_at": bson.M{"$exists": true}},
		bson.M{"$unset": bson.M{"deleted_at": ""}, "$set": bson.M{"read": false}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not restore notifications"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restored": true, "count": result.ModifiedCount})
}

func (s *Server) permanentlyDeleteMyNotification(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	result, err := s.store.C("notifications").DeleteOne(c.Request.Context(), bson.M{"_id": id, "user_id": userCtx.ID, "deleted_at": bson.M{"$exists": true}})
	if err != nil || result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found in bin"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) permanentlyDeleteAllMyNotifications(c *gin.Context) {
	userCtx, _ := currentUser(c)
	result, err := s.store.C("notifications").DeleteMany(c.Request.Context(), bson.M{"user_id": userCtx.ID, "type": bson.M{"$ne": "team_invitation"}, "deleted_at": bson.M{"$exists": true}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not empty notification bin"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true, "count": result.DeletedCount})
}

func (s *Server) notifyMentions(ctx context.Context, teamID primitive.ObjectID, actorID primitive.ObjectID, content string, sourceType string, relatedID primitive.ObjectID) {
	names := mentionPattern.FindAllStringSubmatch(content, -1)
	if len(names) == 0 {
		return
	}
	seen := map[string]bool{}
	var usernames []string
	for _, match := range names {
		username := strings.ToLower(match[1])
		if !seen[username] {
			seen[username] = true
			usernames = append(usernames, username)
		}
	}
	filter := bson.M{"username": bson.M{"$in": usernames}, "status": models.StatusActive, "role": bson.M{"$ne": models.RoleOwnerAdmin}}
	if !teamID.IsZero() {
		filter["team_id"] = teamID
	}
	cursor, err := s.store.C("users").Find(ctx, filter)
	if err != nil {
		return
	}
	defer cursor.Close(ctx)
	actor := "Someone"
	if actorUser, err := s.loadUser(ctx, actorID); err == nil {
		s.ensureUserIdentity(ctx, &actorUser)
		actor = "@" + actorUser.Username
	}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) != nil || user.ID == actorID {
			continue
		}
		s.insertNotification(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    user.ID,
			Type:      sourceType + "_mention",
			Content:   actor + " mentioned you: " + trimForNotification(content),
			RelatedID: relatedID,
			Read:      false,
			CreatedAt: time.Now(),
		})
	}
}

func (s *Server) enqueueInvitationEmail(ctx context.Context, recipient string, teamName string, staffRole string, link string) {
	if s.mailer == nil {
		return
	}
	body := `<p>You were invited to join <strong>` + html.EscapeString(teamName) + `</strong> as <strong>` + html.EscapeString(staffRoleDisplayName(staffRole)) + `</strong>.</p><p><a href="` + html.EscapeString(link) + `">Open invitation</a></p>`
	_ = s.mailer.Enqueue(ctx, models.EmailQueueItem{
		Recipient: recipient,
		Type:      "team_invitation",
		Subject:   "Invitation to join " + teamName,
		BodyHTML:  body,
	})
}

func trimForNotification(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 160 {
		return value[:157] + "..."
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
