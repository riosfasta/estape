package handlers

import (
	"context"
	"html"
	template "html/template"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"
	"bugmark/internal/pagebuilder"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) adminUsers(c *gin.Context) {
	filter := bson.M{}
	if role := firstNonEmpty(strings.TrimSpace(c.Query("level")), strings.TrimSpace(c.Query("role"))); role != "" {
		filter["role"] = role
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		filter["status"] = status
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		pattern := regexp.QuoteMeta(q)
		filter["$or"] = []bson.M{
			{"name": bson.M{"$regex": pattern, "$options": "i"}},
			{"email": bson.M{"$regex": pattern, "$options": "i"}},
			{"username": bson.M{"$regex": pattern, "$options": "i"}},
		}
	}
	cursor, err := s.store.C("users").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(500))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load users"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var users []models.User
	if err := cursor.All(c.Request.Context(), &users); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode users"})
		return
	}
	if users == nil {
		users = []models.User{}
	}
	rows := s.adminUserRows(c.Request.Context(), users)
	if membership := strings.TrimSpace(c.Query("membership")); membership != "" {
		filtered := []gin.H{}
		for _, row := range rows {
			if row["membership_status"] == membership {
				filtered = append(filtered, row)
			}
		}
		rows = filtered
	}
	c.JSON(http.StatusOK, gin.H{"users": rows})
}

func (s *Server) adminCreateUser(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Name        string `json:"name"`
		Email       string `json:"email"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		Role        string `json:"role"`
		StaffRole   string `json:"staff_role"`
		Status      string `json:"status"`
		CompanyName string `json:"company_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if name == "" || email == "" || !strings.Contains(email, "@") || len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name, valid email, and an 8+ character password are required"})
		return
	}
	role := models.Role(strings.TrimSpace(req.Role))
	if role == "" {
		role = models.RoleTeamAdmin
	}
	switch role {
	case models.RoleOwnerAdmin, models.RoleTeamAdmin, models.RoleMember, models.RoleClientAdmin:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		return
	}
	status := models.UserStatus(strings.TrimSpace(req.Status))
	if status == "" {
		status = models.StatusActive
	}
	switch status {
	case models.StatusActive, models.StatusPending, models.StatusSuspended:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	staffRole := allowedStaffRole(req.StaffRole)
	if staffRole == "" {
		staffRole = "manager"
	}
	username, err := s.requestedUsername(c.Request.Context(), req.Username, name, email)
	if err != nil {
		writeUsernameError(c, err)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not hash password"})
		return
	}
	now := time.Now()
	userID := primitive.NewObjectID()
	teamID := primitive.NilObjectID
	var team *models.Team
	if role != models.RoleOwnerAdmin {
		teamID = primitive.NewObjectID()
		subID, plan, err := s.createTrialSubscription(c.Request.Context(), teamID, now)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create membership"})
			return
		}
		companyName := strings.TrimSpace(req.CompanyName)
		if companyName == "" {
			companyName = name + "'s Company"
		}
		team = &models.Team{
			ID:              teamID,
			Name:            companyName,
			CompanyEmail:    email,
			OwnerAdminID:    userID,
			MemberIDs:       []primitive.ObjectID{userID},
			SubscriptionID:  subID,
			SeatLimitCached: plan.SeatLimit,
			CreatedAt:       now,
		}
	}
	user := models.User{
		ID:              userID,
		Name:            name,
		Email:           email,
		Username:        username,
		PasswordHash:    hash,
		Role:            role,
		StaffRole:       staffRole,
		TeamID:          teamID,
		Status:          status,
		ThemePreference: "system",
		CreatedAt:       now,
	}
	if team != nil {
		if _, err := s.store.C("teams").InsertOne(c.Request.Context(), *team); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create company workspace"})
			return
		}
	}
	if _, err := s.store.C("users").InsertOne(c.Request.Context(), user); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create user"})
		return
	}
	if team != nil {
		_ = s.createStarterWorkspace(c.Request.Context(), team.ID, user.ID, now)
	}
	s.audit(c.Request.Context(), userCtx.ID, "user.created", "user", user.ID)
	s.broadcastAdminUsersChanged(c.Request.Context(), userCtx.ID, "created", user.ID)
	c.JSON(http.StatusCreated, gin.H{"user": user, "team": team})
}

func (s *Server) adminUserDetails(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var user models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&user); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	teams := s.adminTeamsForUser(c.Request.Context(), user)
	teamIDs := make([]primitive.ObjectID, 0, len(teams))
	for _, team := range teams {
		if !team.ID.IsZero() && !containsObjectID(teamIDs, team.ID) {
			teamIDs = append(teamIDs, team.ID)
		}
	}
	subscriptions := s.adminSubscriptionsForTeams(c.Request.Context(), teamIDs, teams)
	planIDs := []primitive.ObjectID{}
	subIDs := []primitive.ObjectID{}
	for _, sub := range subscriptions {
		if !sub.PlanID.IsZero() && !containsObjectID(planIDs, sub.PlanID) {
			planIDs = append(planIDs, sub.PlanID)
		}
		if !sub.ID.IsZero() && !containsObjectID(subIDs, sub.ID) {
			subIDs = append(subIDs, sub.ID)
		}
	}
	plans := s.adminPlansByIDs(c.Request.Context(), planIDs)
	invoices := s.adminInvoicesForTeams(c.Request.Context(), teamIDs, subIDs)
	clientProjects := s.adminClientProjectsForUser(c.Request.Context(), user, teamIDs)
	clientIDs := []primitive.ObjectID{}
	for _, client := range clientProjects {
		if !containsObjectID(clientIDs, client.ID) {
			clientIDs = append(clientIDs, client.ID)
		}
	}
	clientWebsites := s.adminClientWebsites(c.Request.Context(), teamIDs, clientIDs)
	clientTasks := s.adminClientTasksForUser(c.Request.Context(), user, teamIDs)
	workspaceProjects, workspaceTasks := s.adminWorkspaceWorkForUser(c.Request.Context(), user, teamIDs)
	c.JSON(http.StatusOK, gin.H{
		"user":               s.adminUserRows(c.Request.Context(), []models.User{user})[0],
		"teams":              teams,
		"subscriptions":      subscriptions,
		"plans":              plans,
		"invoices":           invoices,
		"client_projects":    clientProjects,
		"client_websites":    clientWebsites,
		"client_tasks":       clientTasks,
		"workspace_projects": workspaceProjects,
		"workspace_tasks":    workspaceTasks,
	})
}

func (s *Server) adminApproveUser(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	_, err := s.store.C("users").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"status": models.StatusActive}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not approve user"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "user.approved", "user", id)
	s.broadcastAdminUsersChanged(c.Request.Context(), userCtx.ID, "approved", id)
	c.JSON(http.StatusOK, gin.H{"approved": true})
}

func (s *Server) adminUpdateUser(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		Name      *string `json:"name"`
		Email     *string `json:"email"`
		Username  *string `json:"username"`
		StaffRole *string `json:"staff_role"`
		Status    *string `json:"status"`
		Role      *string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user update"})
		return
	}
	var target models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&target); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid staff role"})
			return
		}
		set["staff_role"] = staffRole
	}
	if req.Status != nil {
		switch models.UserStatus(*req.Status) {
		case models.StatusActive, models.StatusPending, models.StatusSuspended:
			set["status"] = *req.Status
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
			return
		}
	}
	if req.Role != nil {
		switch models.Role(*req.Role) {
		case models.RoleOwnerAdmin, models.RoleTeamAdmin, models.RoleMember, models.RoleClientAdmin:
			if target.Role == models.RoleOwnerAdmin && models.Role(*req.Role) != models.RoleOwnerAdmin {
				c.JSON(http.StatusBadRequest, gin.H{"error": "platform owner accounts must keep the owner admin role"})
				return
			}
			set["role"] = *req.Role
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
			return
		}
	}
	if len(set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}
	_, err := s.store.C("users").UpdateByID(c.Request.Context(), id, bson.M{"$set": set})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already belongs to another user"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update user"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "user.updated", "user", id)
	s.broadcastAdminUsersChanged(c.Request.Context(), userCtx.ID, "updated", id)
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) adminSetUserMembership(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		PlanID                string `json:"plan_id"`
		BillingPeriod         string `json:"billing_period"`
		Quantity              int    `json:"quantity"`
		Status                string `json:"status"`
		PaymentProvider       string `json:"payment_provider"`
		ExternalTransactionID string `json:"external_transaction_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid membership update"})
		return
	}
	planID, err := objectIDFromString(req.PlanID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid plan_id is required"})
		return
	}
	var target models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&target); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if target.Role == models.RoleOwnerAdmin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "owner admin accounts do not use customer memberships"})
		return
	}
	var team models.Team
	if !target.TeamID.IsZero() {
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": target.TeamID}).Decode(&team)
	}
	if team.ID.IsZero() {
		_ = s.store.C("teams").FindOne(c.Request.Context(), bson.M{"owner_admin_id": target.ID}).Decode(&team)
	}
	if team.ID.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user does not have a company workspace to assign membership"})
		return
	}
	var plan models.Plan
	if err := s.store.C("plans").FindOne(c.Request.Context(), bson.M{"_id": planID}).Decode(&plan); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status == "" {
		status = "active"
	}
	switch status {
	case "active", "trialing", "pending_approval":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "membership status must be active, trialing, or pending_approval"})
		return
	}
	period := normalizedBillingPeriod(req.BillingPeriod)
	quantity := normalizedBillingQuantity(req.Quantity)
	provider := strings.ToLower(strings.TrimSpace(req.PaymentProvider))
	if provider == "" {
		provider = "manual"
	}
	switch provider {
	case "manual", "paypal":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "payment_provider must be manual or paypal"})
		return
	}
	now := time.Now()
	expires := billingExpiry(now, period, quantity)
	var trialEnds *time.Time
	if status == "trialing" && plan.TrialDays > 0 {
		end := now.AddDate(0, 0, plan.TrialDays)
		trialEnds = &end
	}
	amount := planBillingAmount(plan, teamSeatCount(team), period, quantity)
	sub := models.Subscription{
		ID:                    primitive.NewObjectID(),
		TeamID:                team.ID,
		PlanID:                plan.ID,
		Status:                status,
		BillingPeriod:         period,
		BillingQuantity:       quantity,
		PaymentProvider:       provider,
		ExternalTransactionID: strings.TrimSpace(req.ExternalTransactionID),
		TrialEndsAt:           trialEnds,
		ApprovedBy:            userCtx.ID,
		StartedAt:             now,
		ExpiresAt:             &expires,
		CreatedAt:             now,
	}
	update := bson.M{"$set": bson.M{
		"team_id":                 sub.TeamID,
		"plan_id":                 sub.PlanID,
		"status":                  sub.Status,
		"billing_period":          sub.BillingPeriod,
		"billing_quantity":        sub.BillingQuantity,
		"payment_provider":        sub.PaymentProvider,
		"external_transaction_id": sub.ExternalTransactionID,
		"approved_by":             sub.ApprovedBy,
		"started_at":              sub.StartedAt,
		"expires_at":              expires,
	}}
	if trialEnds != nil {
		update["$set"].(bson.M)["trial_ends_at"] = *trialEnds
	} else {
		update["$unset"] = bson.M{"trial_ends_at": ""}
	}
	if team.SubscriptionID.IsZero() {
		if _, err := s.store.C("subscriptions").InsertOne(c.Request.Context(), sub); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create membership"})
			return
		}
	} else {
		sub.ID = team.SubscriptionID
		result, err := s.store.C("subscriptions").UpdateByID(c.Request.Context(), team.SubscriptionID, update)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update membership"})
			return
		}
		if result.MatchedCount == 0 {
			sub.ID = primitive.NewObjectID()
			if _, err := s.store.C("subscriptions").InsertOne(c.Request.Context(), sub); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not recreate membership"})
				return
			}
		}
	}
	if _, err := s.store.C("teams").UpdateByID(c.Request.Context(), team.ID, bson.M{"$set": bson.M{"subscription_id": sub.ID, "seat_limit_cached": plan.SeatLimit}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "membership saved, but team seat cache update failed"})
		return
	}
	var invoice *models.Invoice
	if status == "active" && amount > 0 {
		created := models.Invoice{
			ID:                 primitive.NewObjectID(),
			TeamID:             team.ID,
			SubscriptionID:     sub.ID,
			Amount:             amount,
			Currency:           "usd",
			Status:             "paid",
			PaymentProvider:    provider,
			ExternalInvoiceURL: s.cfg.AppURL + "/settings/billing#invoice-" + sub.ID.Hex(),
			IssuedAt:           now,
		}
		_, _ = s.store.C("invoices").InsertOne(c.Request.Context(), created)
		invoice = &created
	}
	_, _ = s.store.C("notifications").InsertOne(c.Request.Context(), models.Notification{
		ID:        primitive.NewObjectID(),
		UserID:    target.ID,
		Type:      "membership_updated",
		Content:   "Your membership was updated to " + plan.Name + " for " + strconv.Itoa(quantity) + " " + strings.TrimSuffix(period, "ly") + "(s)",
		RelatedID: sub.ID,
		Read:      false,
		CreatedAt: now,
	})
	s.audit(c.Request.Context(), userCtx.ID, "membership.updated", "subscription", sub.ID)
	s.broadcastAdminUsersChanged(c.Request.Context(), userCtx.ID, "membership_updated", id)
	c.JSON(http.StatusOK, gin.H{"updated": true, "subscription": sub, "plan": plan, "invoice": invoice, "amount": amount, "expires_at": expires})
}

func (s *Server) adminRemoveUser(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	if id == userCtx.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "owner cannot remove their own active session account"})
		return
	}
	var target models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&target); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if target.Role == models.RoleOwnerAdmin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "platform owner accounts cannot be deleted"})
		return
	}
	if err := s.cleanupDeletedUser(c.Request.Context(), target); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clean user data: " + err.Error()})
		return
	}
	result, err := s.store.C("users").DeleteOne(c.Request.Context(), bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove user"})
		return
	}
	if result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user was already removed"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "user.removed", "user", id)
	s.broadcastAdminUsersChanged(c.Request.Context(), userCtx.ID, "deleted", id)
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) adminMessageUser(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	if id == userCtx.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "choose another user to message"})
		return
	}
	var target models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&target); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message body"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message content is required"})
		return
	}

	var chat models.Chat
	err := s.store.C("chats").FindOne(c.Request.Context(), bson.M{
		"type":            "direct",
		"participant_ids": bson.M{"$all": []primitive.ObjectID{userCtx.ID, id}},
	}).Decode(&chat)
	if err != nil {
		chat = models.Chat{
			ID:             primitive.NewObjectID(),
			Type:           "direct",
			ParticipantIDs: []primitive.ObjectID{userCtx.ID, id},
			TeamID:         target.TeamID,
			CreatedAt:      time.Now(),
		}
		if _, err := s.store.C("chats").InsertOne(c.Request.Context(), chat); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create conversation"})
			return
		}
	}
	msg := models.Message{
		ID:       primitive.NewObjectID(),
		ChatID:   chat.ID,
		SenderID: userCtx.ID,
		Content:  content,
		SentAt:   time.Now(),
		ReadBy:   []primitive.ObjectID{userCtx.ID},
	}
	if _, err := s.store.C("messages").InsertOne(c.Request.Context(), msg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not send message"})
		return
	}
	_, _ = s.store.C("notifications").InsertOne(c.Request.Context(), models.Notification{
		ID:        primitive.NewObjectID(),
		UserID:    id,
		Type:      "admin_message",
		Content:   "New message from platform admin",
		RelatedID: chat.ID,
		Read:      false,
		CreatedAt: time.Now(),
	})
	s.audit(c.Request.Context(), userCtx.ID, "user.message.sent", "user", id)
	c.JSON(http.StatusCreated, gin.H{"chat": chat, "message": msg})
}

func (s *Server) adminUserRows(ctx context.Context, users []models.User) []gin.H {
	userIDs := []primitive.ObjectID{}
	teamIDs := []primitive.ObjectID{}
	for _, user := range users {
		if !containsObjectID(userIDs, user.ID) {
			userIDs = append(userIDs, user.ID)
		}
		if !user.TeamID.IsZero() && !containsObjectID(teamIDs, user.TeamID) {
			teamIDs = append(teamIDs, user.TeamID)
		}
	}
	teamFilter := []bson.M{}
	if len(teamIDs) > 0 {
		teamFilter = append(teamFilter, bson.M{"_id": bson.M{"$in": teamIDs}})
	}
	if len(userIDs) > 0 {
		teamFilter = append(teamFilter, bson.M{"owner_admin_id": bson.M{"$in": userIDs}})
	}
	teams := []models.Team{}
	if len(teamFilter) > 0 {
		cursor, err := s.store.C("teams").Find(ctx, bson.M{"$or": teamFilter})
		if err == nil {
			defer cursor.Close(ctx)
			_ = cursor.All(ctx, &teams)
		}
	}
	teamsByID := map[primitive.ObjectID]models.Team{}
	ownedTeams := map[primitive.ObjectID][]models.Team{}
	subIDs := []primitive.ObjectID{}
	for _, team := range teams {
		teamsByID[team.ID] = team
		if !team.OwnerAdminID.IsZero() {
			ownedTeams[team.OwnerAdminID] = append(ownedTeams[team.OwnerAdminID], team)
		}
		if !team.SubscriptionID.IsZero() && !containsObjectID(subIDs, team.SubscriptionID) {
			subIDs = append(subIDs, team.SubscriptionID)
		}
	}
	subscriptions := []models.Subscription{}
	if len(subIDs) > 0 {
		cursor, err := s.store.C("subscriptions").Find(ctx, bson.M{"_id": bson.M{"$in": subIDs}})
		if err == nil {
			defer cursor.Close(ctx)
			_ = cursor.All(ctx, &subscriptions)
		}
	}
	subsByID := map[primitive.ObjectID]models.Subscription{}
	planIDs := []primitive.ObjectID{}
	for _, sub := range subscriptions {
		subsByID[sub.ID] = sub
		if !sub.PlanID.IsZero() && !containsObjectID(planIDs, sub.PlanID) {
			planIDs = append(planIDs, sub.PlanID)
		}
	}
	plansByID := map[primitive.ObjectID]models.Plan{}
	for _, plan := range s.adminPlansByIDs(ctx, planIDs) {
		plansByID[plan.ID] = plan
	}
	invoicesByTeam := map[primitive.ObjectID][]models.Invoice{}
	if len(teamIDs) == 0 {
		for _, team := range teams {
			if !team.ID.IsZero() && !containsObjectID(teamIDs, team.ID) {
				teamIDs = append(teamIDs, team.ID)
			}
		}
	}
	if len(teamIDs) > 0 {
		cursor, err := s.store.C("invoices").Find(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}}, options.Find().SetSort(bson.D{{Key: "issued_at", Value: -1}}))
		if err == nil {
			defer cursor.Close(ctx)
			for cursor.Next(ctx) {
				var invoice models.Invoice
				if cursor.Decode(&invoice) == nil {
					invoicesByTeam[invoice.TeamID] = append(invoicesByTeam[invoice.TeamID], invoice)
				}
			}
		}
	}
	rows := []gin.H{}
	for _, user := range users {
		team := s.adminPrimaryTeam(user, teamsByID, ownedTeams)
		var sub models.Subscription
		var plan models.Plan
		paymentMethods := []string{}
		invoices := []models.Invoice{}
		if !team.ID.IsZero() {
			sub = subsByID[team.SubscriptionID]
			plan = plansByID[sub.PlanID]
			invoices = invoicesByTeam[team.ID]
			paymentMethods = adminPaymentMethods(sub, invoices)
		}
		rows = append(rows, gin.H{
			"id":                    user.ID,
			"name":                  user.Name,
			"email":                 user.Email,
			"username":              user.Username,
			"role":                  user.Role,
			"staff_role":            user.StaffRole,
			"status":                user.Status,
			"avatar_url":            user.AvatarURL,
			"team_id":               user.TeamID,
			"created_at":            user.CreatedAt,
			"last_active_at":        user.LastActiveAt,
			"two_factor_enabled":    user.TwoFactorEnabled,
			"team":                  team,
			"plan":                  plan,
			"subscription":          sub,
			"membership_status":     adminMembershipStatus(sub, time.Now()),
			"membership_expires_at": sub.ExpiresAt,
			"trial_ends_at":         sub.TrialEndsAt,
			"payment_provider":      sub.PaymentProvider,
			"payment_transaction":   sub.ExternalTransactionID,
			"payment_methods":       paymentMethods,
			"invoice_count":         len(invoices),
			"latest_invoice":        adminLatestInvoice(invoices),
		})
	}
	return rows
}

func (s *Server) adminPrimaryTeam(user models.User, teamsByID map[primitive.ObjectID]models.Team, ownedTeams map[primitive.ObjectID][]models.Team) models.Team {
	if !user.TeamID.IsZero() {
		if team, ok := teamsByID[user.TeamID]; ok {
			return team
		}
	}
	if teams := ownedTeams[user.ID]; len(teams) > 0 {
		return teams[0]
	}
	return models.Team{}
}

func adminMembershipStatus(sub models.Subscription, now time.Time) string {
	if sub.ID.IsZero() {
		return "no_membership"
	}
	if sub.ExpiresAt != nil && now.After(*sub.ExpiresAt) {
		return "expired"
	}
	if sub.Status == "trialing" && sub.TrialEndsAt != nil && now.After(*sub.TrialEndsAt) {
		return "expired"
	}
	if strings.TrimSpace(sub.Status) == "" {
		return "unknown"
	}
	return sub.Status
}

func adminPaymentMethods(sub models.Subscription, invoices []models.Invoice) []string {
	seen := map[string]bool{}
	methods := []string{}
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		methods = append(methods, value)
	}
	add(sub.PaymentProvider)
	for _, invoice := range invoices {
		add(invoice.PaymentProvider)
	}
	return methods
}

func adminLatestInvoice(invoices []models.Invoice) models.Invoice {
	if len(invoices) == 0 {
		return models.Invoice{}
	}
	return invoices[0]
}

func (s *Server) adminTeamsForUser(ctx context.Context, user models.User) []models.Team {
	or := []bson.M{{"owner_admin_id": user.ID}, {"member_ids": user.ID}}
	if !user.TeamID.IsZero() {
		or = append(or, bson.M{"_id": user.TeamID})
	}
	cursor, err := s.store.C("teams").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return []models.Team{}
	}
	defer cursor.Close(ctx)
	teams := []models.Team{}
	_ = cursor.All(ctx, &teams)
	if teams == nil {
		teams = []models.Team{}
	}
	return teams
}

func (s *Server) adminSubscriptionsForTeams(ctx context.Context, teamIDs []primitive.ObjectID, teams []models.Team) []models.Subscription {
	subIDs := []primitive.ObjectID{}
	for _, team := range teams {
		if !team.SubscriptionID.IsZero() && !containsObjectID(subIDs, team.SubscriptionID) {
			subIDs = append(subIDs, team.SubscriptionID)
		}
	}
	or := []bson.M{}
	if len(teamIDs) > 0 {
		or = append(or, bson.M{"team_id": bson.M{"$in": teamIDs}})
	}
	if len(subIDs) > 0 {
		or = append(or, bson.M{"_id": bson.M{"$in": subIDs}})
	}
	if len(or) == 0 {
		return []models.Subscription{}
	}
	cursor, err := s.store.C("subscriptions").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return []models.Subscription{}
	}
	defer cursor.Close(ctx)
	subs := []models.Subscription{}
	_ = cursor.All(ctx, &subs)
	if subs == nil {
		subs = []models.Subscription{}
	}
	return subs
}

func (s *Server) adminPlansByIDs(ctx context.Context, ids []primitive.ObjectID) []models.Plan {
	if len(ids) == 0 {
		return []models.Plan{}
	}
	cursor, err := s.store.C("plans").Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
	if err != nil {
		return []models.Plan{}
	}
	defer cursor.Close(ctx)
	plans := []models.Plan{}
	_ = cursor.All(ctx, &plans)
	if plans == nil {
		plans = []models.Plan{}
	}
	return plans
}

func (s *Server) adminInvoicesForTeams(ctx context.Context, teamIDs []primitive.ObjectID, subIDs []primitive.ObjectID) []models.Invoice {
	or := []bson.M{}
	if len(teamIDs) > 0 {
		or = append(or, bson.M{"team_id": bson.M{"$in": teamIDs}})
	}
	if len(subIDs) > 0 {
		or = append(or, bson.M{"subscription_id": bson.M{"$in": subIDs}})
	}
	if len(or) == 0 {
		return []models.Invoice{}
	}
	cursor, err := s.store.C("invoices").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "issued_at", Value: -1}}).SetLimit(100))
	if err != nil {
		return []models.Invoice{}
	}
	defer cursor.Close(ctx)
	invoices := []models.Invoice{}
	_ = cursor.All(ctx, &invoices)
	if invoices == nil {
		invoices = []models.Invoice{}
	}
	return invoices
}

func (s *Server) adminClientProjectsForUser(ctx context.Context, user models.User, teamIDs []primitive.ObjectID) []models.ClientProject {
	or := []bson.M{{"member_ids": user.ID}, {"client_admin_ids": user.ID}, {"created_by": user.ID}}
	if len(teamIDs) > 0 {
		or = append(or, bson.M{"team_id": bson.M{"$in": teamIDs}})
	}
	cursor, err := s.store.C("client_projects").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(100))
	if err != nil {
		return []models.ClientProject{}
	}
	defer cursor.Close(ctx)
	clients := []models.ClientProject{}
	_ = cursor.All(ctx, &clients)
	if clients == nil {
		clients = []models.ClientProject{}
	}
	return clients
}

func (s *Server) adminClientWebsites(ctx context.Context, teamIDs []primitive.ObjectID, clientIDs []primitive.ObjectID) []models.ClientWebsite {
	or := []bson.M{}
	if len(teamIDs) > 0 {
		or = append(or, bson.M{"team_id": bson.M{"$in": teamIDs}})
	}
	if len(clientIDs) > 0 {
		or = append(or, bson.M{"client_id": bson.M{"$in": clientIDs}})
	}
	if len(or) == 0 {
		return []models.ClientWebsite{}
	}
	cursor, err := s.store.C("client_websites").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(200))
	if err != nil {
		return []models.ClientWebsite{}
	}
	defer cursor.Close(ctx)
	websites := []models.ClientWebsite{}
	_ = cursor.All(ctx, &websites)
	if websites == nil {
		websites = []models.ClientWebsite{}
	}
	return websites
}

func (s *Server) adminClientTasksForUser(ctx context.Context, user models.User, teamIDs []primitive.ObjectID) []models.ClientTask {
	or := []bson.M{{"assignee_ids": user.ID}, {"created_by": user.ID}}
	if len(teamIDs) > 0 {
		or = append(or, bson.M{"team_id": bson.M{"$in": teamIDs}})
	}
	cursor, err := s.store.C("client_tasks").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(200))
	if err != nil {
		return []models.ClientTask{}
	}
	defer cursor.Close(ctx)
	tasks := []models.ClientTask{}
	_ = cursor.All(ctx, &tasks)
	if tasks == nil {
		tasks = []models.ClientTask{}
	}
	return tasks
}

func (s *Server) adminWorkspaceWorkForUser(ctx context.Context, user models.User, teamIDs []primitive.ObjectID) ([]models.Project, []models.Task) {
	if len(teamIDs) == 0 {
		return []models.Project{}, []models.Task{}
	}
	spaceCursor, err := s.store.C("spaces").Find(ctx, bson.M{"team_id": bson.M{"$in": teamIDs}})
	if err != nil {
		return []models.Project{}, []models.Task{}
	}
	defer spaceCursor.Close(ctx)
	spaceIDs := []primitive.ObjectID{}
	for spaceCursor.Next(ctx) {
		var space models.Space
		if spaceCursor.Decode(&space) == nil && !space.ID.IsZero() {
			spaceIDs = append(spaceIDs, space.ID)
		}
	}
	projects := []models.Project{}
	if len(spaceIDs) > 0 {
		projectCursor, err := s.store.C("projects").Find(ctx, bson.M{"space_id": bson.M{"$in": spaceIDs}}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(100))
		if err == nil {
			defer projectCursor.Close(ctx)
			_ = projectCursor.All(ctx, &projects)
		}
	}
	listIDs := []primitive.ObjectID{}
	for _, project := range projects {
		for _, listID := range project.ListIDs {
			if !containsObjectID(listIDs, listID) {
				listIDs = append(listIDs, listID)
			}
		}
	}
	or := []bson.M{{"assignee_ids": user.ID}, {"created_by": user.ID}}
	if len(listIDs) > 0 {
		or = append(or, bson.M{"list_id": bson.M{"$in": listIDs}})
	}
	taskCursor, err := s.store.C("tasks").Find(ctx, bson.M{"$or": or}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(200))
	if err != nil {
		if projects == nil {
			projects = []models.Project{}
		}
		return projects, []models.Task{}
	}
	defer taskCursor.Close(ctx)
	tasks := []models.Task{}
	_ = taskCursor.All(ctx, &tasks)
	if projects == nil {
		projects = []models.Project{}
	}
	if tasks == nil {
		tasks = []models.Task{}
	}
	return projects, tasks
}

func (s *Server) sendAdminEmail(c *gin.Context) {
	var req struct {
		Recipients []string `json:"recipients"`
		Segment    string   `json:"segment"`
		Type       string   `json:"type"`
		Subject    string   `json:"subject"`
		BodyHTML   string   `json:"body_html"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email body"})
		return
	}
	if req.Type == "" {
		req.Type = "marketing"
	}
	if req.Subject == "" || req.BodyHTML == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subject and body_html are required"})
		return
	}
	recipients := req.Recipients
	if len(recipients) == 0 {
		filter := bson.M{}
		if req.Segment == "team_admins" {
			filter["role"] = models.RoleTeamAdmin
		}
		cursor, err := s.store.C("users").Find(c.Request.Context(), filter)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load recipients"})
			return
		}
		defer cursor.Close(c.Request.Context())
		for cursor.Next(c.Request.Context()) {
			var user models.User
			if cursor.Decode(&user) == nil {
				recipients = append(recipients, user.Email)
			}
		}
	}
	for _, recipient := range recipients {
		_ = s.mailer.Enqueue(c.Request.Context(), models.EmailQueueItem{Recipient: recipient, Type: req.Type, Subject: req.Subject, BodyHTML: req.BodyHTML})
	}
	c.JSON(http.StatusAccepted, gin.H{"queued": len(recipients)})
}

func (s *Server) testSMTPEmail(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "owner user not found"})
		return
	}
	var req struct {
		Recipient string `json:"recipient"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SMTP test body"})
		return
	}
	recipient := strings.ToLower(strings.TrimSpace(req.Recipient))
	if recipient == "" {
		recipient = strings.ToLower(strings.TrimSpace(user.Email))
	}
	if recipient == "" || !strings.Contains(recipient, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid test recipient email is required"})
		return
	}
	if s.mailer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "email service is not available"})
		return
	}
	appName := firstNonEmpty(s.cfg.AppName, "bugmega")
	body := `<p>Hello ` + html.EscapeString(firstNonEmpty(user.Name, user.Username, user.Email, "there")) + `,</p>` +
		`<p>This is a test email from your ` + html.EscapeString(appName) + ` SMTP configuration.</p>` +
		`<p>If this arrived in the inbox, SMTP delivery is working for platform notifications and password OTP emails.</p>` +
		`<p>Sent at ` + html.EscapeString(time.Now().Format("Jan 2, 2006 3:04 PM MST")) + `.</p>`
	err = s.mailer.SendNow(c.Request.Context(), models.EmailQueueItem{
		Recipient: recipient,
		Type:      "smtp_test",
		Subject:   appName + " SMTP test email",
		BodyHTML:  body,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "SMTP test failed: " + err.Error()})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "settings.smtp.tested", "site_settings", primitive.NilObjectID)
	c.JSON(http.StatusOK, gin.H{"sent": true, "recipient": recipient})
}

func (s *Server) getSettings(c *gin.Context) {
	settings, _ := s.loadSiteSettings(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"settings": s.sanitizedSiteSettings(settings)})
}

func (s *Server) updateSettings(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req siteSettingsUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settings body"})
		return
	}
	payPalMode := strings.ToLower(strings.TrimSpace(req.PayPalMode))
	if payPalMode == "" {
		payPalMode = "sandbox"
	}
	if payPalMode != "sandbox" && payPalMode != "live" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paypal mode must be sandbox or live"})
		return
	}
	ownerNotificationEmail := strings.ToLower(strings.TrimSpace(req.OwnerNotificationEmail))
	if ownerNotificationEmail != "" && !strings.Contains(ownerNotificationEmail, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "owner notification email must be a valid email address"})
		return
	}
	timeZone := strings.TrimSpace(req.TimeZone)
	if timeZone == "" {
		timeZone = "UTC"
	}
	if _, err := time.LoadLocation(timeZone); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "time zone must be a valid IANA time zone like America/New_York or Asia/Bangkok"})
		return
	}
	colorFields := map[string]string{
		"theme_primary_color":        req.ThemePrimaryColor,
		"theme_primary_strong_color": req.ThemePrimaryStrongColor,
		"theme_button_color":         req.ThemeButtonColor,
		"theme_button_text_color":    req.ThemeButtonTextColor,
		"theme_font_color":           req.ThemeFontColor,
		"theme_heading_color":        req.ThemeHeadingColor,
		"theme_background_color":     req.ThemeBackgroundColor,
	}
	set := bson.M{
		"site_name":                 strings.TrimSpace(req.SiteName),
		"company_slogan":            strings.TrimSpace(req.CompanySlogan),
		"company_email":             strings.TrimSpace(req.CompanyEmail),
		"company_contact":           strings.TrimSpace(req.CompanyContact),
		"owner_name":                strings.TrimSpace(req.OwnerName),
		"company_address":           strings.TrimSpace(req.CompanyAddress),
		"logo_url":                  strings.TrimSpace(req.LogoURL),
		"favicon_url":               strings.TrimSpace(req.FaviconURL),
		"support_phone":             strings.TrimSpace(req.SupportPhone),
		"time_zone":                 timeZone,
		"social_links":              normalizeSocialLinks(req.SocialLinks),
		"google_signin_enabled":     req.GoogleSigninEnabled,
		"google_client_id":          strings.TrimSpace(req.GoogleClientID),
		"google_redirect_url":       strings.TrimSpace(req.GoogleRedirectURL),
		"smtp_enabled":              req.SMTPEnabled,
		"smtp_host":                 strings.TrimSpace(req.SMTPHost),
		"smtp_port":                 firstNonEmpty(strings.TrimSpace(req.SMTPPort), "587"),
		"smtp_user":                 strings.TrimSpace(req.SMTPUser),
		"smtp_from":                 strings.TrimSpace(req.SMTPFrom),
		"owner_notification_email":  ownerNotificationEmail,
		"owner_notify_registration": req.OwnerNotifyRegistration,
		"owner_notify_purchase":     req.OwnerNotifyPurchase,
		"owner_notify_new_chat":     req.OwnerNotifyNewChat,
		"owner_notifications_set":   true,
		"stripe_enabled":            false,
		"stripe_publishable_key":    "",
		"paypal_enabled":            req.PayPalEnabled,
		"paypal_mode":               payPalMode,
		"paypal_client_id":          strings.TrimSpace(req.PayPalClientID),
		"paypal_webhook_id":         strings.TrimSpace(req.PayPalWebhookID),
		"updated_at":                time.Now(),
	}
	for field, raw := range colorFields {
		color, ok := cleanOptionalHexColor(raw)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": field + " must be a hex color like #0b8f7a"})
			return
		}
		set[field] = color
	}
	unset := bson.M{}
	if secret := strings.TrimSpace(req.GoogleClientSecret); secret != "" {
		set["google_client_secret"] = secret
	} else if req.ClearGoogleClientSecret {
		unset["google_client_secret"] = ""
	}
	if secret := strings.TrimSpace(req.SMTPPassword); secret != "" {
		set["smtp_password"] = secret
	} else if req.ClearSMTPPassword {
		unset["smtp_password"] = ""
	}
	unset["stripe_secret_key"] = ""
	unset["stripe_webhook_secret"] = ""
	if secret := strings.TrimSpace(req.PayPalClientSecret); secret != "" {
		set["paypal_client_secret"] = secret
	} else if req.ClearPayPalClientSecret {
		unset["paypal_client_secret"] = ""
	}
	update := bson.M{"$set": set}
	if len(unset) > 0 {
		update["$unset"] = unset
	}
	_, err := s.store.C("site_settings").UpdateOne(c.Request.Context(), bson.M{}, update, options.Update().SetUpsert(true))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update settings"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "settings.updated", "site_settings", primitive.NilObjectID)
	settings, _ := s.loadSiteSettings(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"updated": true, "settings": s.sanitizedSiteSettings(settings)})
}

func (s *Server) adminPages(c *gin.Context) {
	userCtx, _ := currentUser(c)
	_ = s.ensureEditableHomePage(c.Request.Context(), userCtx.ID)
	cursor, err := s.store.C("static_pages").Find(c.Request.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load pages"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var pages []models.StaticPage
	if err := cursor.All(c.Request.Context(), &pages); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode pages"})
		return
	}
	if pages == nil {
		pages = []models.StaticPage{}
	}
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	c.JSON(http.StatusOK, gin.H{"pages": pages, "nav_items": settings.PublicNavItems, "nav_settings": s.publicNavSettingsPayload(settings)})
}

func (s *Server) ensureEditableHomePage(ctx context.Context, userID primitive.ObjectID) error {
	count, err := s.store.C("static_pages").CountDocuments(ctx, bson.M{"slug": "home"})
	if err != nil || count > 0 {
		return err
	}
	now := time.Now()
	page := models.StaticPage{
		ID:        primitive.NewObjectID(),
		Slug:      "home",
		Title:     firstNonEmpty(s.cfg.AppName, "Home"),
		PageWidth: "100%",
		Status:    "draft",
		Blocks:    defaultHomePageBlocks(firstNonEmpty(s.cfg.AppName, "Home")),
		Versions:  []models.PageVersion{},
		UpdatedBy: userID,
		UpdatedAt: now,
	}
	_, err = s.store.C("static_pages").InsertOne(ctx, page)
	return err
}

func (s *Server) savePublicNav(c *gin.Context) {
	var req struct {
		LogoURL     string                 `json:"logo_url"`
		CompanyName string                 `json:"company_name"`
		ButtonText  string                 `json:"button_text"`
		ButtonURL   string                 `json:"button_url"`
		ButtonStyle string                 `json:"button_style"`
		Items       []models.PublicNavItem `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid navigation body"})
		return
	}
	items := normalizePublicNavItems(req.Items)
	if len(items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "add at least one navigation item"})
		return
	}
	_, err := s.store.C("site_settings").UpdateOne(c.Request.Context(), bson.M{}, bson.M{"$set": bson.M{
		"public_nav_logo_url":     strings.TrimSpace(req.LogoURL),
		"public_nav_company_name": strings.TrimSpace(req.CompanyName),
		"public_nav_button_text":  strings.TrimSpace(req.ButtonText),
		"public_nav_button_url":   normalizePublicNavURL(req.ButtonURL, "/register"),
		"public_nav_button_style": normalizePublicNavButtonStyle(req.ButtonStyle),
		"public_nav_items":        items,
		"updated_at":              time.Now(),
	}}, options.Update().SetUpsert(true))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save navigation"})
		return
	}
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	c.JSON(http.StatusOK, gin.H{"saved": true, "nav_items": settings.PublicNavItems, "nav_settings": s.publicNavSettingsPayload(settings)})
}

func normalizePublicNavItems(items []models.PublicNavItem) []models.PublicNavItem {
	out := []models.PublicNavItem{}
	for _, item := range items {
		if len(out) >= 20 {
			break
		}
		label := strings.TrimSpace(item.Label)
		url := normalizePublicNavURL(item.URL, "")
		if label == "" || url == "" {
			continue
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = primitive.NewObjectID().Hex()
		}
		out = append(out, models.PublicNavItem{
			ID:      id,
			Label:   label,
			URL:     url,
			Visible: item.Visible,
			Order:   len(out) + 1,
		})
	}
	return out
}

func normalizePublicNavURL(raw string, fallback string) string {
	url := strings.TrimSpace(raw)
	if url == "" || strings.HasPrefix(strings.ToLower(url), "javascript:") {
		return strings.TrimSpace(fallback)
	}
	lower := strings.ToLower(url)
	if strings.HasPrefix(url, "/") ||
		strings.HasPrefix(url, "#") ||
		strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") {
		return url
	}
	return "/" + strings.TrimLeft(url, "/")
}

func (s *Server) createPage(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Slug  string `json:"slug"`
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page body"})
		return
	}
	req.Slug = slugify(req.Slug)
	if req.Slug == "" || strings.TrimSpace(req.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slug and title are required"})
		return
	}
	now := time.Now()
	blocks := []models.PageBlock{{ID: primitive.NewObjectID().Hex(), Type: "heading", Props: map[string]interface{}{"text": req.Title, "level": "h1"}}}
	pageWidth := "840px"
	if req.Slug == "home" {
		blocks = defaultHomePageBlocks(req.Title)
		pageWidth = "100%"
	}
	page := models.StaticPage{
		ID:        primitive.NewObjectID(),
		Slug:      req.Slug,
		Title:     strings.TrimSpace(req.Title),
		PageWidth: pageWidth,
		Status:    "draft",
		Blocks:    blocks,
		Versions:  []models.PageVersion{},
		UpdatedBy: userCtx.ID,
		UpdatedAt: now,
	}
	if _, err := s.store.C("static_pages").InsertOne(c.Request.Context(), page); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "page slug already exists"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"page": page})
}

func defaultHomePageBlocks(title string) []models.PageBlock {
	return []models.PageBlock{
		{ID: primitive.NewObjectID().Hex(), Type: "hero", Props: map[string]interface{}{"eyebrow": "Visual feedback meets team delivery", "heading": title, "text": "Build tasks, feedback, chat, billing, and time tracking into one public-ready workspace.", "primary_label": "Get Started", "primary_url": "/register", "secondary_label": "View Pricing", "secondary_url": "/pricing"}},
		{ID: primitive.NewObjectID().Hex(), Type: "feature_grid", Props: map[string]interface{}{"title_1": "Task management", "text_1": "Organize projects, assignments, due dates, and status boards.", "title_2": "Website feedback", "text_2": "Capture page annotations and turn them into work.", "title_3": "Reports", "text_3": "Track completion, time, and delivery history."}},
		{ID: primitive.NewObjectID().Hex(), Type: "cta", Props: map[string]interface{}{"heading": "Bring visual QA and delivery work together.", "text": "Customize this home page, publish it, and it will replace the default landing page.", "label": "Start Free Trial", "url": "/register"}},
	}
}

var publicPageWidthPattern = regexp.MustCompile(`^\d+(\.\d+)?(px|%|vw)$`)

func safePublicPageWidth(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "840px"
	}
	if !publicPageWidthPattern.MatchString(value) {
		return "840px"
	}
	number, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(value, "px"), "vw"), "%"), 64)
	if err != nil || number <= 0 {
		return "840px"
	}
	if strings.HasSuffix(value, "px") && number > 2400 {
		return "2400px"
	}
	if strings.HasSuffix(value, "%") && number > 100 {
		return "100%"
	}
	if strings.HasSuffix(value, "vw") && number > 100 {
		return "100vw"
	}
	return value
}

func (s *Server) pageBuilderPlans(ctx context.Context) []models.Plan {
	cursor, err := s.store.C("plans").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "price", Value: 1}, {Key: "price_per_seat", Value: 1}, {Key: "name", Value: 1}}))
	if err != nil {
		return []models.Plan{}
	}
	defer cursor.Close(ctx)
	plans := []models.Plan{}
	if err := cursor.All(ctx, &plans); err != nil {
		return []models.Plan{}
	}
	return plans
}

func (s *Server) pageBuilderContext(ctx context.Context, page models.StaticPage) pagebuilder.RenderContext {
	settings, _ := s.loadSiteSettings(ctx)
	settings = s.settingsWithConfigFallback(settings)
	pageWidth := page.PageWidth
	if strings.TrimSpace(pageWidth) == "" && page.Slug == "home" {
		pageWidth = "100%"
	}
	return pagebuilder.RenderContext{
		Settings:  settings,
		Plans:     s.pageBuilderPlans(ctx),
		PageWidth: safePublicPageWidth(pageWidth),
	}
}

func (s *Server) renderStaticPageHTML(ctx context.Context, page models.StaticPage) (string, pagebuilder.RenderContext) {
	renderCtx := s.pageBuilderContext(ctx, page)
	if len(page.Blocks) == 0 {
		return page.RenderedHTMLCache, renderCtx
	}
	return pagebuilder.Render(page.Blocks, renderCtx), renderCtx
}

func (s *Server) getPage(c *gin.Context) {
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug")}).Decode(&page); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"page": page})
}

func (s *Server) savePageDraft(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Title     string             `json:"title"`
		PageWidth string             `json:"page_width"`
		Blocks    []models.PageBlock `json:"blocks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page draft"})
		return
	}
	if len(req.Blocks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "blocks are required"})
		return
	}
	set := bson.M{"blocks": req.Blocks, "status": "draft", "updated_by": userCtx.ID, "updated_at": time.Now()}
	if strings.TrimSpace(req.Title) != "" {
		set["title"] = strings.TrimSpace(req.Title)
	}
	if strings.TrimSpace(req.PageWidth) != "" {
		set["page_width"] = safePublicPageWidth(req.PageWidth)
	}
	res, err := s.store.C("static_pages").UpdateOne(c.Request.Context(), bson.M{"slug": c.Param("slug")}, bson.M{"$set": set})
	if err != nil || res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

func (s *Server) publishPage(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug")}).Decode(&page); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	html, renderCtx := s.renderStaticPageHTML(c.Request.Context(), page)
	version := models.PageVersion{ID: primitive.NewObjectID(), PageWidth: renderCtx.PageWidth, Blocks: page.Blocks, HTML: html, CreatedAt: time.Now(), CreatedBy: userCtx.ID}
	versions := append([]models.PageVersion{version}, page.Versions...)
	if len(versions) > 10 {
		versions = versions[:10]
	}
	_, err := s.store.C("static_pages").UpdateOne(c.Request.Context(), bson.M{"_id": page.ID}, bson.M{"$set": bson.M{"status": "published", "rendered_html_cache": html, "versions": versions, "updated_by": userCtx.ID, "updated_at": time.Now()}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not publish page"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"published": true, "html": html})
}

func (s *Server) pageVersions(c *gin.Context) {
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug")}).Decode(&page); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"versions": page.Versions})
}

func (s *Server) restorePageVersion(c *gin.Context) {
	userCtx, _ := currentUser(c)
	versionID, ok := objectIDParam(c, "versionId")
	if !ok {
		return
	}
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug")}).Decode(&page); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	for _, version := range page.Versions {
		if version.ID == versionID {
			pageWidth := version.PageWidth
			if strings.TrimSpace(pageWidth) == "" && page.Slug == "home" {
				pageWidth = "100%"
			}
			_, err := s.store.C("static_pages").UpdateByID(c.Request.Context(), page.ID, bson.M{"$set": bson.M{"blocks": version.Blocks, "page_width": safePublicPageWidth(pageWidth), "rendered_html_cache": version.HTML, "status": "draft", "updated_by": userCtx.ID, "updated_at": time.Now()}})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not restore version"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"restored": true})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
}

func (s *Server) getPublicPage(c *gin.Context) {
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug"), "status": "published"}).Decode(&page); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	html, renderCtx := s.renderStaticPageHTML(c.Request.Context(), page)
	c.JSON(http.StatusOK, gin.H{"title": page.Title, "html": html, "page_width": renderCtx.PageWidth})
}

func (s *Server) publicLegalPage(c *gin.Context) {
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug"), "status": "published"}).Decode(&page); err != nil {
		settings, _ := s.loadSiteSettings(c.Request.Context())
		settings = s.settingsWithConfigFallback(settings)
		c.HTML(http.StatusNotFound, "legal.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": "Page not found", "HTML": template.HTML("<p>Page not found.</p>"), "Year": time.Now().Year()}))
		return
	}
	html, renderCtx := s.renderStaticPageHTML(c.Request.Context(), page)
	c.HTML(http.StatusOK, "legal.gohtml", s.withPublicPageChrome(renderCtx.Settings, gin.H{"Title": page.Title, "HTML": template.HTML(html), "Year": time.Now().Year(), "PageWidth": renderCtx.PageWidth}))
}

func (s *Server) publicStaticPage(c *gin.Context) {
	slug := slugify(c.Param("slug"))
	if slug == "" || slug == "home" {
		c.Redirect(http.StatusFound, "/")
		return
	}
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": slug, "status": "published"}).Decode(&page); err != nil {
		settings, _ := s.loadSiteSettings(c.Request.Context())
		settings = s.settingsWithConfigFallback(settings)
		c.HTML(http.StatusNotFound, "legal.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": "Page not found", "HTML": template.HTML("<p>Page not found.</p>"), "Year": time.Now().Year()}))
		return
	}
	html, renderCtx := s.renderStaticPageHTML(c.Request.Context(), page)
	c.HTML(http.StatusOK, "legal.gohtml", s.withPublicPageChrome(renderCtx.Settings, gin.H{"Title": page.Title, "HTML": template.HTML(html), "Year": time.Now().Year(), "PageWidth": renderCtx.PageWidth}))
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '-'
	})
	return strings.Trim(strings.Join(fields, "-"), "-")
}
