package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"html"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type registerRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	Username      string `json:"username"`
	CompanyName   string `json:"company_name"`
	WorkspaceName string `json:"workspace_name"`
	InviteToken   string `json:"invite_token"`
}

const (
	passwordUpdateOTPPurpose  = "password_update"
	passwordUpdateOTPMinutes  = 10
	passwordUpdateMaxAttempts = 5
)

func (s *Server) register(c *gin.Context) {
	if !s.allowRegistrationAttempt(c) {
		return
	}

	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registration body"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.Email == "" || len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name, email, and an 8+ character password are required"})
		return
	}
	companyName := strings.TrimSpace(req.CompanyName)
	if companyName == "" {
		companyName = strings.TrimSpace(req.WorkspaceName)
	}
	if companyName == "" {
		companyName = req.Name + "'s Company"
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not hash password"})
		return
	}

	ctx := c.Request.Context()
	now := time.Now()
	userID := primitive.NewObjectID()
	username, err := s.requestedUsername(ctx, req.Username, req.Name, req.Email)
	if err != nil {
		writeUsernameError(c, err)
		return
	}
	var invitation *models.TeamInvitation
	if strings.TrimSpace(req.InviteToken) != "" {
		var loaded models.TeamInvitation
		err := s.store.C("team_invitations").FindOne(ctx, bson.M{"token": strings.TrimSpace(req.InviteToken), "status": "pending", "expires_at": bson.M{"$gt": now}}).Decode(&loaded)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invitation is invalid or expired"})
			return
		}
		if loaded.Email != req.Email {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invitation email must match registration email"})
			return
		}
		invitation = &loaded
		if loaded.Username != "" && strings.TrimSpace(req.Username) == "" {
			invitedUsername := normalizeUsername(loaded.Username)
			if invitedUsername == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": errInvalidUsername.Error()})
				return
			}
			exists, err := s.usernameExists(ctx, invitedUsername)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create username"})
				return
			}
			if exists {
				c.JSON(http.StatusConflict, gin.H{"error": errUsernameExists.Error()})
				return
			}
			username = invitedUsername
		}
	}
	teamID := primitive.NewObjectID()
	role := models.RoleTeamAdmin
	staffRole := "manager"
	trialSubID, trialPlan, err := s.createTrialSubscription(ctx, teamID, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create trial subscription"})
		return
	}
	team := &models.Team{
		ID:              teamID,
		Name:            companyName,
		CompanyEmail:    req.Email,
		OwnerAdminID:    userID,
		MemberIDs:       []primitive.ObjectID{userID},
		SubscriptionID:  trialSubID,
		SeatLimitCached: trialPlan.SeatLimit,
		CreatedAt:       now,
	}
	user := models.User{
		ID:              userID,
		Name:            req.Name,
		Email:           req.Email,
		Username:        username,
		PasswordHash:    hash,
		Role:            role,
		StaffRole:       staffRole,
		TeamID:          teamID,
		Status:          models.StatusActive,
		ThemePreference: "system",
		CreatedAt:       now,
	}

	if _, err := s.store.C("teams").InsertOne(ctx, *team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create team"})
		return
	}
	if _, err := s.store.C("users").InsertOne(ctx, user); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create user"})
		return
	}
	if err := s.createStarterWorkspace(ctx, teamID, userID, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create starter workspace"})
		return
	}
	if invitation != nil {
		s.linkPendingInvitationToNewUser(ctx, *invitation, user)
	}
	registrationTeam := *team
	s.enqueueOwnerRegistrationEmail(ctx, user, registrationTeam, "Email/password", invitation)

	access, refresh, err := s.issueTokens(ctx, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue tokens"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": user, "access_token": access, "refresh_token": refresh})
}

func (s *Server) linkPendingInvitationToNewUser(ctx context.Context, invitation models.TeamInvitation, user models.User) {
	update := bson.M{"existing_user_id": user.ID}
	if strings.TrimSpace(invitation.Username) == "" && strings.TrimSpace(user.Username) != "" {
		update["username"] = user.Username
	}
	_, _ = s.store.C("team_invitations").UpdateByID(ctx, invitation.ID, bson.M{"$set": update})

	teamName := "the company"
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": invitation.TeamID}).Decode(&team); err == nil && strings.TrimSpace(team.Name) != "" {
		teamName = team.Name
	}
	s.notifyUserIDs(ctx, []primitive.ObjectID{user.ID}, invitation.InvitedBy, "team_invitation", "You were invited to join "+teamName+".", invitation.ID)
}

func (s *Server) login(c *gin.Context) {
	var req struct {
		Email         string `json:"email"`
		Password      string `json:"password"`
		TwoFactorCode string `json:"two_factor_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid login body"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	var user models.User
	err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"email": req.Email}).Decode(&user)
	if err != nil || auth.ComparePassword(user.PasswordHash, req.Password) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}
	s.ensureUserIdentity(c.Request.Context(), &user)
	if user.Status == models.StatusSuspended {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is suspended"})
		return
	}
	if user.TwoFactorEnabled {
		if strings.TrimSpace(req.TwoFactorCode) == "" {
			c.JSON(http.StatusOK, gin.H{"two_factor_required": true})
			return
		}
		if !auth.VerifyTOTP(user.TwoFactorSecret, req.TwoFactorCode, time.Now()) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authenticator code"})
			return
		}
	}
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue tokens"})
		return
	}
	_, _ = s.store.C("users").UpdateByID(c.Request.Context(), user.ID, bson.M{"$set": bson.M{"last_active_at": time.Now()}})
	c.JSON(http.StatusOK, gin.H{"user": user, "access_token": access, "refresh_token": refresh})
}

func (s *Server) refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.RefreshToken) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh_token is required"})
		return
	}
	var user models.User
	err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"refresh_token_hash": auth.HashToken(req.RefreshToken)}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if user.Status == models.StatusSuspended {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is suspended"})
		return
	}
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue tokens"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"access_token": access, "refresh_token": refresh})
}

func (s *Server) me(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	s.ensureUserIdentity(c.Request.Context(), &user)
	var team *models.Team
	if !user.TeamID.IsZero() {
		var loaded models.Team
		if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": user.TeamID}).Decode(&loaded); err == nil {
			team = &loaded
		}
	}
	var personalTeam *models.Team
	if user.Role != models.RoleOwnerAdmin {
		if owned, err := s.personalTeamForUser(c.Request.Context(), user, time.Now()); err == nil {
			personalTeam = &owned
		}
	}
	var companyAccess gin.H
	companyAccesses := make([]gin.H, 0)
	companyAccessTeams := map[primitive.ObjectID]bool{}
	inviteCursor, inviteErr := s.store.C("team_invitations").Find(
		c.Request.Context(),
		bson.M{"existing_user_id": user.ID, "status": "accepted"},
		options.Find().SetSort(bson.D{{Key: "responded_at", Value: -1}, {Key: "created_at", Value: -1}}),
	)
	if inviteErr == nil {
		defer inviteCursor.Close(c.Request.Context())
		for inviteCursor.Next(c.Request.Context()) {
			var invitation models.TeamInvitation
			if inviteCursor.Decode(&invitation) != nil || invitation.TeamID.IsZero() || companyAccessTeams[invitation.TeamID] {
				continue
			}
			var invitedTeam models.Team
			if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": invitation.TeamID, "member_ids": user.ID}).Decode(&invitedTeam); err != nil {
				continue
			}
			joinedAt := invitation.CreatedAt
			if invitation.RespondedAt != nil {
				joinedAt = *invitation.RespondedAt
			}
			companyAccessTeams[invitation.TeamID] = true
			companyAccesses = append(companyAccesses, gin.H{
				"team_id":          invitedTeam.ID,
				"company_name":     invitedTeam.Name,
				"company_logo_url": invitedTeam.LogoURL,
				"company_role":     teamRoleForStaffRole(invitation.StaffRole),
				"staff_role":       invitation.StaffRole,
				"status":           models.StatusActive,
				"joined_at":        joinedAt,
				"current":          invitedTeam.ID == user.TeamID,
				"membership":       s.membershipAccessPayload(c.Request.Context(), invitedTeam.ID),
			})
		}
	}
	if isInvitedCompanyRole(user.Role) && team != nil {
		joinedAt := user.CreatedAt
		var invitation models.TeamInvitation
		err := s.store.C("team_invitations").FindOne(
			c.Request.Context(),
			bson.M{"team_id": user.TeamID, "existing_user_id": user.ID, "status": "accepted"},
			options.FindOne().SetSort(bson.D{{Key: "responded_at", Value: -1}, {Key: "created_at", Value: -1}}),
		).Decode(&invitation)
		if err == nil {
			if invitation.RespondedAt != nil {
				joinedAt = *invitation.RespondedAt
			} else {
				joinedAt = invitation.CreatedAt
			}
		}
		companyAccess = gin.H{
			"team_id":          team.ID,
			"company_name":     team.Name,
			"company_logo_url": team.LogoURL,
			"company_role":     user.Role,
			"staff_role":       user.StaffRole,
			"status":           user.Status,
			"joined_at":        joinedAt,
			"membership":       s.membershipAccessPayload(c.Request.Context(), team.ID),
		}
		if !companyAccessTeams[team.ID] && containsObjectID(team.MemberIDs, user.ID) {
			companyAccesses = append(companyAccesses, gin.H{
				"team_id":          team.ID,
				"company_name":     team.Name,
				"company_logo_url": team.LogoURL,
				"company_role":     user.Role,
				"staff_role":       user.StaffRole,
				"status":           user.Status,
				"joined_at":        joinedAt,
				"current":          true,
				"membership":       s.membershipAccessPayload(c.Request.Context(), team.ID),
			})
		}
	}
	unreadCommentCount := s.unreadTaskCommentCount(c.Request.Context(), user.ID, user.TeamID)
	membershipTeamID := user.TeamID
	if personalTeam != nil {
		membershipTeamID = personalTeam.ID
	}
	membership := s.membershipAccessPayload(c.Request.Context(), membershipTeamID)
	if user.Role == models.RoleOwnerAdmin {
		membership["status"] = "active"
		membership["allowed"] = true
		membership["trial"] = false
	}
	c.JSON(http.StatusOK, gin.H{
		"user":                 user,
		"team":                 team,
		"personal_team":        personalTeam,
		"company_access":       companyAccess,
		"company_accesses":     companyAccesses,
		"membership":           membership,
		"unread_comment_count": unreadCommentCount,
		"platform_settings":    s.publicPlatformSettings(c.Request.Context()),
	})
}

func (s *Server) updateMyProfile(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Name      string `json:"name"`
		Email     string `json:"email"`
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	username := normalizeUsername(req.Username)
	avatarURL := strings.TrimSpace(req.AvatarURL)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid email is required"})
		return
	}
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errInvalidUsername.Error()})
		return
	}
	emailCount, err := s.store.C("users").CountDocuments(c.Request.Context(), bson.M{"email": email, "_id": bson.M{"$ne": userCtx.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check email"})
		return
	}
	if emailCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "email already exists"})
		return
	}
	usernameCount, err := s.store.C("users").CountDocuments(c.Request.Context(), bson.M{"username": username, "_id": bson.M{"$ne": userCtx.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check username"})
		return
	}
	if usernameCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": errUsernameExists.Error()})
		return
	}
	set := bson.M{
		"name":       name,
		"email":      email,
		"username":   username,
		"avatar_url": avatarURL,
	}
	if _, err := s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": set}); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update profile"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not reload profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (s *Server) updateMyCompanyProfile(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if user.Role == models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "owner admin company profile is managed in platform settings"})
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
	name := strings.TrimSpace(req.Name)
	companyEmail := strings.ToLower(strings.TrimSpace(req.CompanyEmail))
	logoURL := strings.TrimSpace(req.LogoURL)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "company name is required"})
		return
	}
	if companyEmail != "" && !strings.Contains(companyEmail, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid company email is required"})
		return
	}
	now := time.Now()
	team, err := s.personalTeamForUser(c.Request.Context(), user, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare personal company"})
		return
	}
	set := bson.M{
		"name":          name,
		"company_email": companyEmail,
		"logo_url":      logoURL,
	}
	if _, err := s.store.C("teams").UpdateByID(c.Request.Context(), team.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update company profile"})
		return
	}
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": team.ID}).Decode(&team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not reload company profile"})
		return
	}
	s.audit(c.Request.Context(), user.ID, "personal_company.profile.updated", "team", team.ID)
	c.JSON(http.StatusOK, gin.H{"team": team})
}

func (s *Server) updatePreferences(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Theme string `json:"theme"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid preferences body"})
		return
	}
	switch req.Theme {
	case "light", "dark", "system":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "theme must be light, dark, or system"})
		return
	}
	_, err := s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": bson.M{"theme_preference": req.Theme}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update preferences"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"theme": req.Theme})
}

func (s *Server) updatePassword(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid password body"})
		return
	}
	if len(req.NewPassword) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be at least 8 characters"})
		return
	}
	code := strings.TrimSpace(req.Code)
	if len(code) != 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter the 6-digit email code"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	now := time.Now()
	var otp models.PasswordUpdateOTP
	err = s.store.C("password_update_otps").FindOne(
		c.Request.Context(),
		activePasswordOTPFilter(user.ID, now),
		options.FindOne().SetSort(bson.D{{Key: "created_at", Value: -1}}),
	).Decode(&otp)
	if err != nil || otp.AttemptCount >= passwordUpdateMaxAttempts {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "verification code is invalid or expired"})
		return
	}
	if auth.ComparePassword(otp.CodeHash, passwordOTPSecret(user.ID, code)) != nil {
		_, _ = s.store.C("password_update_otps").UpdateByID(c.Request.Context(), otp.ID, bson.M{"$inc": bson.M{"attempt_count": 1}})
		c.JSON(http.StatusUnauthorized, gin.H{"error": "verification code is invalid or expired"})
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not hash password"})
		return
	}
	_, err = s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": bson.M{"password_hash": hash}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update password"})
		return
	}
	_, _ = s.store.C("password_update_otps").UpdateMany(c.Request.Context(), activePasswordOTPFilter(user.ID, now), bson.M{"$set": bson.M{"used_at": now}})
	user.PasswordHash = hash
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not refresh session"})
		return
	}
	s.audit(c.Request.Context(), user.ID, "user.password.updated", "user", user.ID)
	c.JSON(http.StatusOK, gin.H{"updated": true, "access_token": access, "refresh_token": refresh})
}

func (s *Server) requestPasswordUpdateOTP(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(user.Email))
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "add a valid email to your profile before updating your password"})
		return
	}
	if s.mailer == nil || !s.mailer.CanSend(c.Request.Context()) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SMTP email is not configured. Ask the platform owner to set up SMTP mail first."})
		return
	}
	code, err := randomSixDigitCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create verification code"})
		return
	}
	codeHash, err := auth.HashPassword(passwordOTPSecret(user.ID, code))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not secure verification code"})
		return
	}
	now := time.Now()
	_, _ = s.store.C("password_update_otps").UpdateMany(c.Request.Context(), activePasswordOTPFilter(user.ID, now), bson.M{"$set": bson.M{"used_at": now}})
	otp := models.PasswordUpdateOTP{
		ID:        primitive.NewObjectID(),
		UserID:    user.ID,
		Email:     email,
		Purpose:   passwordUpdateOTPPurpose,
		CodeHash:  codeHash,
		ExpiresAt: now.Add(passwordUpdateOTPMinutes * time.Minute),
		CreatedAt: now,
	}
	if _, err := s.store.C("password_update_otps").InsertOne(c.Request.Context(), otp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save verification code"})
		return
	}
	if err := s.enqueuePasswordUpdateOTPEmail(c.Request.Context(), user, code, otp.ExpiresAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"sent":               true,
		"email":              maskEmail(email),
		"expires_in_minutes": passwordUpdateOTPMinutes,
	})
}

func activePasswordOTPFilter(userID primitive.ObjectID, now time.Time) bson.M {
	return bson.M{
		"user_id":    userID,
		"purpose":    passwordUpdateOTPPurpose,
		"expires_at": bson.M{"$gt": now},
		"$or": []bson.M{
			{"used_at": bson.M{"$exists": false}},
			{"used_at": nil},
		},
	}
}

func passwordOTPSecret(userID primitive.ObjectID, code string) string {
	return userID.Hex() + ":" + strings.TrimSpace(code)
}

func randomSixDigitCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func (s *Server) enqueuePasswordUpdateOTPEmail(ctx context.Context, user models.User, code string, expiresAt time.Time) error {
	if s.mailer == nil {
		return fmt.Errorf("email service is not configured")
	}
	appName := firstNonEmpty(s.cfg.AppName, "bugmega")
	name := firstNonEmpty(user.Name, user.Username, user.Email, "there")
	body := `<p>Hello ` + html.EscapeString(name) + `,</p>` +
		`<p>Use this one-time code to update your ` + html.EscapeString(appName) + ` password:</p>` +
		`<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0;">` + html.EscapeString(code) + `</p>` +
		`<p>This code expires at ` + html.EscapeString(expiresAt.Format("Jan 2, 2006 3:04 PM MST")) + `.</p>` +
		`<p>If you did not request a password update, you can ignore this email.</p>`
	return s.mailer.Enqueue(ctx, models.EmailQueueItem{
		Recipient: strings.ToLower(strings.TrimSpace(user.Email)),
		Type:      "password_update_otp",
		Subject:   appName + " password update code",
		BodyHTML:  body,
	})
}

func maskEmail(email string) string {
	parts := strings.SplitN(strings.TrimSpace(email), "@", 2)
	if len(parts) != 2 || parts[0] == "" {
		return email
	}
	localRunes := []rune(parts[0])
	if len(localRunes) == 1 {
		return string(localRunes[0]) + "***@" + parts[1]
	}
	return string(localRunes[0]) + "***" + string(localRunes[len(localRunes)-1]) + "@" + parts[1]
}

func (s *Server) setupTwoFactor(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create 2FA secret"})
		return
	}
	otpauthURL := auth.TOTPURI(firstNonEmpty(s.cfg.AppName, "BugMega"), firstNonEmpty(user.Email, user.Username, user.ID.Hex()), secret)
	qrPNG, err := qrcode.Encode(otpauthURL, qrcode.Medium, 256)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create 2FA QR code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"secret":          secret,
		"otpauth_url":     otpauthURL,
		"qr_png_data_url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrPNG),
	})
}

func (s *Server) enableTwoFactor(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Secret string `json:"secret"`
		Code   string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid 2FA body"})
		return
	}
	if !auth.VerifyTOTP(req.Secret, req.Code, time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid authenticator code"})
		return
	}
	_, err := s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": bson.M{"two_factor_enabled": true, "two_factor_secret": strings.ToUpper(strings.TrimSpace(req.Secret))}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not enable 2FA"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"two_factor_enabled": true})
}

func (s *Server) disableTwoFactor(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		CurrentPassword string `json:"current_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid 2FA body"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if auth.ComparePassword(user.PasswordHash, req.CurrentPassword) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
		return
	}
	_, err = s.store.C("users").UpdateByID(c.Request.Context(), userCtx.ID, bson.M{"$set": bson.M{"two_factor_enabled": false}, "$unset": bson.M{"two_factor_secret": ""}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not disable 2FA"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"two_factor_enabled": false})
}

func (s *Server) uploadFile(c *gin.Context) {
	userCtx, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".pdf": true, ".txt": true, ".csv": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".zip": true}
	if !allowed[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type"})
		return
	}
	name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	userDir := userUploadDir(userCtx.ID)
	path := filepath.Join(s.cfg.UploadDir, userDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare upload directory"})
		return
	}
	uploadPurpose := strings.ToLower(strings.TrimSpace(c.PostForm("purpose")))
	imagePurposes := map[string]bool{"profile": true, "platform_logo": true, "platform_favicon": true, "public_nav_logo": true}
	if imagePurposes[uploadPurpose] {
		if err := saveProfileUpload(file, path, ext, 500); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	} else if err := c.SaveUploadedFile(file, path); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save file"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"url": "/uploads/" + filepath.ToSlash(filepath.Join(userDir, name))})
}

func (s *Server) issueTokens(ctx context.Context, user models.User) (string, string, error) {
	access, err := s.tokens.GenerateAccessToken(user)
	if err != nil {
		return "", "", err
	}
	refresh, hash, err := auth.NewRefreshToken()
	if err != nil {
		return "", "", err
	}
	_, err = s.store.C("users").UpdateByID(ctx, user.ID, bson.M{"$set": bson.M{"refresh_token_hash": hash}})
	return access, refresh, err
}

func (s *Server) createTrialSubscription(ctx context.Context, teamID primitive.ObjectID, now time.Time) (primitive.ObjectID, models.Plan, error) {
	var plan models.Plan
	err := s.store.C("plans").FindOne(ctx, bson.M{"featured": true}).Decode(&plan)
	if err != nil {
		err = s.store.C("plans").FindOne(ctx, bson.M{}).Decode(&plan)
	}
	if err != nil {
		return primitive.NilObjectID, models.Plan{}, err
	}
	end := now.AddDate(0, 0, defaultTrialDays)
	sub := models.Subscription{
		ID:              primitive.NewObjectID(),
		TeamID:          teamID,
		PlanID:          plan.ID,
		Status:          "trialing",
		BillingPeriod:   "monthly",
		BillingQuantity: 1,
		TrialEndsAt:     &end,
		StartedAt:       now,
		CreatedAt:       now,
	}
	_, err = s.store.C("subscriptions").InsertOne(ctx, sub)
	return sub.ID, plan, err
}

func (s *Server) createStarterWorkspace(ctx context.Context, teamID primitive.ObjectID, userID primitive.ObjectID, now time.Time) error {
	spaceID := primitive.NewObjectID()
	projectID := primitive.NewObjectID()
	listID := primitive.NewObjectID()
	space := models.Space{ID: spaceID, TeamID: teamID, Name: "Product", ProjectIDs: []primitive.ObjectID{projectID}, CreatedAt: now}
	project := models.Project{ID: projectID, SpaceID: spaceID, Name: "Website Feedback", ListIDs: []primitive.ObjectID{listID}, CreatedAt: now}
	list := models.List{ID: listID, ProjectID: projectID, Name: "Launch QA", Statuses: []string{"To Do", "In Progress", "Done"}, TaskIDs: []primitive.ObjectID{}, CreatedAt: now}
	task := models.Task{
		ID:          primitive.NewObjectID(),
		ListID:      listID,
		Title:       "Click anywhere on a tracked website to create your first bug pin",
		Description: "This starter task shows the task board and bug conversion flow.",
		Status:      "To Do",
		Priority:    "Normal",
		AssigneeIDs: []primitive.ObjectID{userID},
		Tags:        []string{"starter"},
		Checklist:   []models.ChecklistItem{{Text: "Add a website", Done: false}, {Text: "Drop a pin", Done: false}, {Text: "Convert the pin to a task", Done: false}},
		Attachments: []string{},
		Comments:    []models.Comment{},
		CreatedBy:   userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	list.TaskIDs = append(list.TaskIDs, task.ID)
	if _, err := s.store.C("spaces").InsertOne(ctx, space); err != nil {
		return err
	}
	if _, err := s.store.C("projects").InsertOne(ctx, project); err != nil {
		return err
	}
	if _, err := s.store.C("lists").InsertOne(ctx, list); err != nil {
		return err
	}
	_, err := s.store.C("tasks").InsertOne(ctx, task)
	return err
}
