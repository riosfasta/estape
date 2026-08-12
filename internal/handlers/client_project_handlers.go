package handlers

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) listClientProjects(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
			return
		}
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}
	access := s.clientAccessSets(c.Request.Context(), userCtx)
	filter := bson.M{}
	if userCtx.Role != models.RoleOwnerAdmin {
		clientIDs := uniqueObjectIDs(append(append([]primitive.ObjectID{}, access.FullClientIDs...), access.DomainClientIDs...))
		if len(clientIDs) == 0 {
			c.JSON(http.StatusOK, gin.H{"clients": []models.ClientProject{}, "websites": []models.ClientWebsite{}})
			return
		}
		filter = bson.M{"_id": bson.M{"$in": clientIDs}}
	}
	cursor, err := s.store.C("client_projects").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load client projects"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var clients []models.ClientProject
	if err := cursor.All(c.Request.Context(), &clients); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode client projects"})
		return
	}
	if clients == nil {
		clients = []models.ClientProject{}
	}
	clientIDs := make([]primitive.ObjectID, 0, len(clients))
	for _, client := range clients {
		clientIDs = append(clientIDs, client.ID)
	}
	websites := []models.ClientWebsite{}
	if len(clientIDs) > 0 {
		siteFilter := bson.M{"client_id": bson.M{"$in": clientIDs}}
		if userCtx.Role != models.RoleOwnerAdmin {
			or := []bson.M{}
			if len(access.FullClientIDs) > 0 {
				or = append(or, bson.M{"client_id": bson.M{"$in": access.FullClientIDs}})
			}
			if len(access.WebsiteIDs) > 0 {
				or = append(or, bson.M{"_id": bson.M{"$in": access.WebsiteIDs}})
			}
			if len(or) == 0 {
				siteFilter = bson.M{"_id": primitive.NewObjectID()}
			} else {
				siteFilter = bson.M{"$or": or}
			}
		}
		siteCursor, err := s.store.C("client_websites").Find(c.Request.Context(), siteFilter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
		if err == nil {
			defer siteCursor.Close(c.Request.Context())
			_ = siteCursor.All(c.Request.Context(), &websites)
		}
	}
	c.JSON(http.StatusOK, gin.H{"clients": clients, "websites": websites})
}

type clientAccessSet struct {
	FullClientIDs   []primitive.ObjectID
	DomainClientIDs []primitive.ObjectID
	WebsiteIDs      []primitive.ObjectID
}

func (s *Server) clientAccessSets(ctx context.Context, userCtx middleware.UserContext) clientAccessSet {
	out := clientAccessSet{}
	if userCtx.Role == models.RoleOwnerAdmin {
		return out
	}
	clientFilter := bson.M{}
	switch userCtx.Role {
	case models.RoleTeamAdmin:
		clientFilter["team_id"] = userCtx.TeamID
	default:
		clientFilter["$or"] = []bson.M{
			{"member_ids": userCtx.ID},
			{"client_admin_ids": userCtx.ID},
			{"created_by": userCtx.ID},
		}
	}
	cursor, err := s.store.C("client_projects").Find(ctx, clientFilter, options.Find().SetProjection(bson.M{"_id": 1}))
	if err == nil {
		defer cursor.Close(ctx)
		for cursor.Next(ctx) {
			var client models.ClientProject
			if cursor.Decode(&client) == nil && !client.ID.IsZero() {
				out.FullClientIDs = append(out.FullClientIDs, client.ID)
			}
		}
	}
	if userCtx.Role != models.RoleTeamAdmin {
		siteCursor, err := s.store.C("client_websites").Find(ctx, bson.M{"$or": []bson.M{
			{"member_ids": userCtx.ID},
			{"client_admin_ids": userCtx.ID},
			{"created_by": userCtx.ID},
		}}, options.Find().SetProjection(bson.M{"_id": 1, "client_id": 1}))
		if err == nil {
			defer siteCursor.Close(ctx)
			for siteCursor.Next(ctx) {
				var site models.ClientWebsite
				if siteCursor.Decode(&site) == nil {
					if !site.ID.IsZero() {
						out.WebsiteIDs = append(out.WebsiteIDs, site.ID)
					}
					if !site.ClientID.IsZero() {
						out.DomainClientIDs = append(out.DomainClientIDs, site.ClientID)
					}
				}
			}
		}
	}
	out.FullClientIDs = uniqueObjectIDs(out.FullClientIDs)
	out.DomainClientIDs = uniqueObjectIDs(out.DomainClientIDs)
	out.WebsiteIDs = uniqueObjectIDs(out.WebsiteIDs)
	return out
}

func (s *Server) clientTaskAccessFilter(ctx context.Context, userCtx middleware.UserContext, clientIDs []primitive.ObjectID) bson.M {
	base := bson.M{"client_id": bson.M{"$in": clientIDs}}
	if userCtx.Role == models.RoleOwnerAdmin {
		return base
	}
	access := s.clientAccessSets(ctx, userCtx)
	or := []bson.M{}
	fullClientIDs := []primitive.ObjectID{}
	for _, id := range access.FullClientIDs {
		if containsObjectID(clientIDs, id) {
			fullClientIDs = append(fullClientIDs, id)
		}
	}
	if len(fullClientIDs) > 0 {
		or = append(or, bson.M{"client_id": bson.M{"$in": fullClientIDs}})
	}
	if len(access.WebsiteIDs) > 0 {
		or = append(or, bson.M{"website_id": bson.M{"$in": access.WebsiteIDs}})
	}
	if len(or) == 0 {
		return bson.M{"_id": primitive.NewObjectID()}
	}
	return bson.M{"$and": []bson.M{base, {"$or": or}}}
}

func (s *Server) createClientProject(c *gin.Context) {
	userCtx, _ := currentUser(c)
	userRole := userCtx.Role
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
			return
		}
		userRole = user.Role
	}
	if userRole == models.RoleClientAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "client admins can only manage assigned client folders"})
		return
	}
	team, ok := s.personalWorkspaceTeam(c)
	if !ok {
		return
	}
	if !s.requireTeamFeatureAccess(c, team.ID, "client folders") {
		return
	}
	var req struct {
		Name         string `json:"name"`
		CompanyEmail string `json:"company_email"`
		ContactName  string `json:"contact_name"`
		Details      string `json:"details"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid client body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client company name is required"})
		return
	}
	now := time.Now()
	client := models.ClientProject{
		ID:             primitive.NewObjectID(),
		TeamID:         team.ID,
		Name:           name,
		CompanyEmail:   strings.ToLower(strings.TrimSpace(req.CompanyEmail)),
		ContactName:    strings.TrimSpace(req.ContactName),
		Details:        strings.TrimSpace(req.Details),
		MemberIDs:      []primitive.ObjectID{userCtx.ID},
		ClientAdminIDs: []primitive.ObjectID{},
		CreatedBy:      userCtx.ID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if _, err := s.store.C("client_projects").InsertOne(c.Request.Context(), client); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create client"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"client": client})
}

func (s *Server) getClientProject(c *gin.Context) {
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, false)
	if !ok {
		return
	}
	userCtx, _ := currentUser(c)
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}
	websites, _ := s.clientWebsitesForAccess(c.Request.Context(), client, userCtx)
	folderAccess := s.canManageClientProject(c.Request.Context(), userCtx, client) || containsObjectID(client.MemberIDs, userCtx.ID) || containsObjectID(client.ClientAdminIDs, userCtx.ID) || client.CreatedBy == userCtx.ID
	documents := []models.ClientDocument{}
	members := []gin.H{}
	if folderAccess {
		documents, _ = s.clientDocuments(c.Request.Context(), client.ID, primitive.NilObjectID)
		members = s.clientProjectMembers(c.Request.Context(), client)
	}
	c.JSON(http.StatusOK, gin.H{
		"client":             client,
		"websites":           websites,
		"documents":          documents,
		"members":            members,
		"can_manage":         s.canManageClientProject(c.Request.Context(), userCtx, client),
		"can_manage_members": s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID),
		"can_delete":         s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID),
	})
}

func (s *Server) updateClientProject(c *gin.Context) {
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, true)
	if !ok {
		return
	}
	var req struct {
		Name         *string `json:"name"`
		CompanyEmail *string `json:"company_email"`
		ContactName  *string `json:"contact_name"`
		Details      *string `json:"details"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid client update"})
		return
	}
	set := bson.M{"updated_at": time.Now()}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "client company name is required"})
			return
		}
		set["name"] = name
	}
	if req.CompanyEmail != nil {
		set["company_email"] = strings.ToLower(strings.TrimSpace(*req.CompanyEmail))
	}
	if req.ContactName != nil {
		set["contact_name"] = strings.TrimSpace(*req.ContactName)
	}
	if req.Details != nil {
		set["details"] = strings.TrimSpace(*req.Details)
	}
	if _, err := s.store.C("client_projects").UpdateByID(c.Request.Context(), client.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update client"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteClientProject(c *gin.Context) {
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, false)
	if !ok {
		return
	}
	userCtx, _ := currentUser(c)
	if !s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins or platform owners can delete client folders"})
		return
	}
	if _, err := s.store.C("client_projects").DeleteOne(c.Request.Context(), bson.M{"_id": client.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete client"})
		return
	}
	s.deleteClientTaskNotificationsForFilter(c.Request.Context(), bson.M{"client_id": client.ID})
	s.deleteNotificationsByRelatedIDs(c.Request.Context(), []primitive.ObjectID{client.ID}, "client_project_added", "client_project_role_updated")
	_, _ = s.store.C("client_websites").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_documents").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_tabs").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_task_logs").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func clientAccessStaffRole(requested string, member models.User) string {
	staffRole := allowedStaffRole(requested)
	if staffRole == "" {
		staffRole = allowedStaffRole(member.StaffRole)
	}
	if staffRole == "" {
		staffRole = "internal"
	}
	return staffRole
}

func (s *Server) syncClientAccessStaffRole(ctx context.Context, member models.User, staffRole string) error {
	set := bson.M{"staff_role": staffRole}
	_, err := s.store.C("users").UpdateByID(ctx, member.ID, bson.M{"$set": set})
	return err
}

func (s *Server) addClientProjectMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, false)
	if !ok {
		return
	}
	if !s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can add members to client folders"})
		return
	}
	if !s.requireTeamFeatureAccess(c, client.TeamID, "project members") {
		return
	}
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member body"})
		return
	}
	memberID, err := objectIDFromString(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}
	var member models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": memberID}).Decode(&member); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
		return
	}
	if member.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "only active team members can be added to client folders"})
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": client.TeamID}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client team not found"})
		return
	}
	if member.TeamID != client.TeamID && !containsObjectID(team.MemberIDs, memberID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "member must be listed on this team before project access can be granted"})
		return
	}
	staffRole := clientAccessStaffRole(req.Role, member)
	targetRole := "member"
	update := bson.M{"$addToSet": bson.M{"member_ids": memberID}, "$pull": bson.M{"client_admin_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	if staffRole == string(models.RoleClientAdmin) {
		targetRole = string(models.RoleClientAdmin)
		update = bson.M{"$addToSet": bson.M{"client_admin_ids": memberID}, "$pull": bson.M{"member_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	}
	alreadyTargetRole := (targetRole == string(models.RoleClientAdmin) && containsObjectID(client.ClientAdminIDs, memberID)) || (targetRole == "member" && containsObjectID(client.MemberIDs, memberID))
	alreadyHadAccess := containsObjectID(client.ClientAdminIDs, memberID) || containsObjectID(client.MemberIDs, memberID)
	if _, err := s.store.C("client_projects").UpdateByID(c.Request.Context(), client.ID, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not add member"})
		return
	}
	if err := s.syncClientAccessStaffRole(c.Request.Context(), member, staffRole); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update member role"})
		return
	}
	if !alreadyTargetRole && member.ID != userCtx.ID {
		roleName := staffRoleDisplayName(staffRole)
		notificationType := "client_project_added"
		content := "You were added to " + client.Name + " as " + roleName + "."
		if alreadyHadAccess {
			notificationType = "client_project_role_updated"
			content = "Your access to " + client.Name + " was updated to " + roleName + "."
		}
		s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{memberID}, userCtx.ID, notificationType, content, client.ID)
	}
	c.JSON(http.StatusCreated, gin.H{"added": true})
}

func (s *Server) removeClientProjectMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, false)
	if !ok {
		return
	}
	if !s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can remove members from client folders"})
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if memberID == client.CreatedBy {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the client folder creator"})
		return
	}
	_, err := s.store.C("client_projects").UpdateByID(c.Request.Context(), client.ID, bson.M{
		"$pull": bson.M{"member_ids": memberID, "client_admin_ids": memberID},
		"$set":  bson.M{"updated_at": time.Now()},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove member"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) addClientWebsiteMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, false)
	if !ok {
		return
	}
	if !s.canManageTeamSilently(c.Request.Context(), userCtx, site.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can share domain access"})
		return
	}
	if !s.requireTeamFeatureAccess(c, site.TeamID, "domain members") {
		return
	}
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain member body"})
		return
	}
	memberID, err := objectIDFromString(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}
	var member models.User
	if err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"_id": memberID}).Decode(&member); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found"})
		return
	}
	if member.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "only active team members can be added to domains"})
		return
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": site.TeamID}).Decode(&team); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "domain team not found"})
		return
	}
	if member.TeamID != site.TeamID && !containsObjectID(team.MemberIDs, memberID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "member must be invited to this company before domain access can be granted"})
		return
	}
	staffRole := clientAccessStaffRole(req.Role, member)
	targetRole := "member"
	update := bson.M{"$addToSet": bson.M{"member_ids": memberID}, "$pull": bson.M{"client_admin_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	if staffRole == string(models.RoleClientAdmin) {
		targetRole = string(models.RoleClientAdmin)
		update = bson.M{"$addToSet": bson.M{"client_admin_ids": memberID}, "$pull": bson.M{"member_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	}
	alreadyTargetRole := (targetRole == string(models.RoleClientAdmin) && containsObjectID(site.ClientAdminIDs, memberID)) || (targetRole == "member" && containsObjectID(site.MemberIDs, memberID))
	alreadyHadAccess := containsObjectID(site.ClientAdminIDs, memberID) || containsObjectID(site.MemberIDs, memberID)
	if _, err := s.store.C("client_websites").UpdateByID(c.Request.Context(), site.ID, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not share domain access"})
		return
	}
	if err := s.syncClientAccessStaffRole(c.Request.Context(), member, staffRole); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update member role"})
		return
	}
	if !alreadyTargetRole && member.ID != userCtx.ID {
		roleName := staffRoleDisplayName(staffRole)
		notificationType := "client_domain_added"
		content := "You were added to " + site.Name + " as " + roleName + "."
		if alreadyHadAccess {
			notificationType = "client_domain_role_updated"
			content = "Your access to " + site.Name + " was updated to " + roleName + "."
		}
		s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{memberID}, userCtx.ID, notificationType, content, site.ID)
	}
	c.JSON(http.StatusCreated, gin.H{"added": true})
}

func (s *Server) removeClientWebsiteMember(c *gin.Context) {
	userCtx, _ := currentUser(c)
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, false)
	if !ok {
		return
	}
	if !s.canManageTeamSilently(c.Request.Context(), userCtx, site.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can remove domain access"})
		return
	}
	memberID, ok := objectIDParam(c, "userId")
	if !ok {
		return
	}
	if memberID == site.CreatedBy {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the domain creator"})
		return
	}
	if _, err := s.store.C("client_websites").UpdateByID(c.Request.Context(), site.ID, bson.M{
		"$pull": bson.M{"member_ids": memberID, "client_admin_ids": memberID},
		"$set":  bson.M{"updated_at": time.Now()},
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove domain access"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (s *Server) createClientDocument(c *gin.Context) {
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, true)
	if !ok {
		return
	}
	var req struct {
		WebsiteID string `json:"website_id"`
		Title     string `json:"title"`
		Kind      string `json:"kind"`
		Content   string `json:"content"`
		URL       string `json:"url"`
		FileURL   string `json:"file_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid document body"})
		return
	}
	userCtx, _ := currentUser(c)
	websiteID := primitive.NilObjectID
	if strings.TrimSpace(req.WebsiteID) != "" {
		id, err := objectIDFromString(req.WebsiteID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid website_id"})
			return
		}
		if _, ok := s.loadClientWebsiteForAccess(c, id, true); !ok {
			return
		}
		websiteID = id
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document title is required"})
		return
	}
	kind := clientDocumentKind(req.Kind)
	now := time.Now()
	doc := models.ClientDocument{
		ID:        primitive.NewObjectID(),
		ClientID:  client.ID,
		WebsiteID: websiteID,
		TeamID:    client.TeamID,
		Title:     title,
		Kind:      kind,
		Content:   strings.TrimSpace(req.Content),
		URL:       strings.TrimSpace(req.URL),
		FileURL:   strings.TrimSpace(req.FileURL),
		CreatedBy: userCtx.ID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.store.C("client_documents").InsertOne(c.Request.Context(), doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create document"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"document": doc})
}

func (s *Server) deleteClientDocument(c *gin.Context) {
	docID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var doc models.ClientDocument
	if err := s.store.C("client_documents").FindOne(c.Request.Context(), bson.M{"_id": docID}).Decode(&doc); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document not found"})
		return
	}
	if _, ok := s.loadClientProjectForAccess(c, doc.ClientID, true); !ok {
		return
	}
	if _, err := s.store.C("client_documents").DeleteOne(c.Request.Context(), bson.M{"_id": docID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete document"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) createClientWebsite(c *gin.Context) {
	clientID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, true)
	if !ok {
		return
	}
	if !s.requireTeamFeatureAccess(c, client.TeamID, "domains") {
		return
	}
	var req struct {
		Name    string `json:"name"`
		URL     string `json:"url"`
		Details string `json:"details"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid website body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "website name is required"})
		return
	}
	userCtx, _ := currentUser(c)
	now := time.Now()
	site := models.ClientWebsite{
		ID:        primitive.NewObjectID(),
		ClientID:  client.ID,
		TeamID:    client.TeamID,
		Name:      name,
		URL:       normalizeOptionalURL(req.URL),
		Details:   strings.TrimSpace(req.Details),
		CreatedBy: userCtx.ID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.store.C("client_websites").InsertOne(c.Request.Context(), site); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create website"})
		return
	}
	defaultTab := defaultClientTaskBoardTab(site, userCtx.ID, now)
	if _, err := s.store.C("client_tabs").InsertOne(c.Request.Context(), defaultTab); err != nil {
		_, _ = s.store.C("client_websites").DeleteOne(c.Request.Context(), bson.M{"_id": site.ID})
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create default task board"})
		return
	}
	s.broadcastClientTabChanged(c.Request.Context(), defaultTab, userCtx.ID, "client_tab_created")
	c.JSON(http.StatusCreated, gin.H{"website": site, "tab": defaultTab})
}

func (s *Server) getClientWebsite(c *gin.Context) {
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, false)
	if !ok {
		return
	}
	client, ok := s.loadClientProjectForAccess(c, site.ClientID, false)
	if !ok {
		return
	}
	tabs, _ := s.clientTabs(c.Request.Context(), site.ID)
	documents, _ := s.clientDocuments(c.Request.Context(), client.ID, site.ID)
	tasks, _ := s.clientTasks(c.Request.Context(), site.ID)
	userCtx, _ := currentUser(c)
	members := s.mergeMemberRows(s.clientProjectMembers(c.Request.Context(), client), s.clientWebsiteMembers(c.Request.Context(), site))
	c.JSON(http.StatusOK, gin.H{
		"client":              client,
		"website":             site,
		"tabs":                tabs,
		"documents":           documents,
		"tasks":               tasks,
		"members":             members,
		"can_manage":          s.canManageClientWebsite(c.Request.Context(), userCtx, site),
		"can_update_progress": true,
		"can_manage_statuses": s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID),
	})
}

func (s *Server) updateClientWebsite(c *gin.Context) {
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, true)
	if !ok {
		return
	}
	var req struct {
		Name    *string `json:"name"`
		URL     *string `json:"url"`
		Details *string `json:"details"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid website update"})
		return
	}
	set := bson.M{"updated_at": time.Now()}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "website name is required"})
			return
		}
		set["name"] = name
	}
	if req.URL != nil {
		set["url"] = normalizeOptionalURL(*req.URL)
	}
	if req.Details != nil {
		set["details"] = strings.TrimSpace(*req.Details)
	}
	if _, err := s.store.C("client_websites").UpdateByID(c.Request.Context(), site.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update website"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteClientWebsite(c *gin.Context) {
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, true)
	if !ok {
		return
	}
	s.deleteClientTaskNotificationsForFilter(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_tabs").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_task_logs").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_documents").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	if _, err := s.store.C("client_websites").DeleteOne(c.Request.Context(), bson.M{"_id": site.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete website"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) createClientTab(c *gin.Context) {
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, true)
	if !ok {
		return
	}
	if !s.requireTeamFeatureAccess(c, site.TeamID, "project tabs") {
		return
	}
	var req struct {
		Type         string                                  `json:"type"`
		Title        string                                  `json:"title"`
		Content      string                                  `json:"content"`
		Statuses     []string                                `json:"statuses"`
		StatusStyles map[string]models.ClientTaskStatusStyle `json:"status_styles"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tab body"})
		return
	}
	tabType := clientTabType(req.Type)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = clientTabDefaultTitle(tabType)
	}
	userCtx, _ := currentUser(c)
	if (len(req.Statuses) > 0 || len(req.StatusStyles) > 0) && !s.canManageTeamSilently(c.Request.Context(), userCtx, site.TeamID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can customize board statuses"})
		return
	}
	now := time.Now()
	statuses := normalizeClientTaskStatuses(req.Statuses)
	tab := models.ClientTab{
		ID:           primitive.NewObjectID(),
		ClientID:     site.ClientID,
		WebsiteID:    site.ID,
		TeamID:       site.TeamID,
		Type:         tabType,
		Title:        title,
		Content:      strings.TrimSpace(req.Content),
		Statuses:     statuses,
		StatusStyles: normalizeClientTaskStatusStyles(statuses, req.StatusStyles),
		CreatedBy:    userCtx.ID,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := s.store.C("client_tabs").InsertOne(c.Request.Context(), tab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create tab"})
		return
	}
	s.broadcastClientTabChanged(c.Request.Context(), tab, userCtx.ID, "client_tab_created")
	c.JSON(http.StatusCreated, gin.H{"tab": tab})
}

func (s *Server) updateClientTab(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	var req struct {
		Title        *string                                 `json:"title"`
		Content      *string                                 `json:"content"`
		Statuses     []string                                `json:"statuses"`
		StatusStyles map[string]models.ClientTaskStatusStyle `json:"status_styles"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tab update"})
		return
	}
	set := bson.M{"updated_at": time.Now()}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tab title is required"})
			return
		}
		set["title"] = title
	}
	if req.Content != nil {
		set["content"] = strings.TrimSpace(*req.Content)
	}
	if (req.Statuses != nil || req.StatusStyles != nil) && !s.canManageClientStatuses(c, tab) {
		return
	}
	if req.Statuses != nil {
		set["statuses"] = normalizeClientTaskStatuses(req.Statuses)
	}
	if req.StatusStyles != nil {
		statuses := normalizeClientTaskStatuses(tab.Statuses)
		if req.Statuses != nil {
			statuses = set["statuses"].([]string)
		}
		set["status_styles"] = normalizeClientTaskStatusStyles(statuses, req.StatusStyles)
	}
	if _, err := s.store.C("client_tabs").UpdateByID(c.Request.Context(), tab.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update tab"})
		return
	}
	userCtx, _ := currentUser(c)
	s.broadcastClientTabChanged(c.Request.Context(), tab, userCtx.ID, "client_tab_updated")
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) updateClientTabStatus(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	if !s.canManageClientStatuses(c, tab) {
		return
	}
	oldStatus := normalizeClientTaskStatus(c.Param("status"))
	if oldStatus == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	var req struct {
		Status    *string `json:"status"`
		IconColor *string `json:"icon_color"`
		TextColor *string `json:"text_color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status update"})
		return
	}
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	oldIndex := indexOfString(statuses, oldStatus)
	if oldIndex < 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "status not found"})
		return
	}
	nextStatus := oldStatus
	if req.Status != nil {
		nextStatus = normalizeClientTaskStatus(*req.Status)
		if nextStatus == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status name is required"})
			return
		}
		if nextStatus != oldStatus && containsString(statuses, nextStatus) {
			c.JSON(http.StatusConflict, gin.H{"error": "status already exists"})
			return
		}
	}
	styles := normalizeClientTaskStatusStyles(statuses, tab.StatusStyles)
	if styles == nil {
		styles = map[string]models.ClientTaskStatusStyle{}
	}
	style := styles[oldStatus]
	if req.IconColor != nil {
		color := normalizeHexColor(*req.IconColor)
		if color == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid icon color"})
			return
		}
		style.IconColor = color
	}
	if req.TextColor != nil {
		color := normalizeHexColor(*req.TextColor)
		if color == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid text color"})
			return
		}
		style.TextColor = color
	}
	statuses[oldIndex] = nextStatus
	delete(styles, oldStatus)
	styles[nextStatus] = style
	styles = normalizeClientTaskStatusStyles(statuses, styles)
	now := time.Now()
	if _, err := s.store.C("client_tabs").UpdateByID(c.Request.Context(), tab.ID, bson.M{"$set": bson.M{"statuses": statuses, "status_styles": styles, "updated_at": now}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update status"})
		return
	}
	if nextStatus != oldStatus {
		_, _ = s.store.C("client_tasks").UpdateMany(c.Request.Context(), bson.M{"tab_id": tab.ID, "status": oldStatus}, bson.M{"$set": bson.M{"status": nextStatus, "updated_at": now}})
	}
	userCtx, _ := currentUser(c)
	s.broadcastClientTabChanged(c.Request.Context(), tab, userCtx.ID, "client_tab_status_updated")
	c.JSON(http.StatusOK, gin.H{"updated": true, "statuses": statuses, "status_styles": styles})
}

func (s *Server) deleteClientTabStatus(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	if !s.canManageClientStatuses(c, tab) {
		return
	}
	status := normalizeClientTaskStatus(c.Param("status"))
	if status == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	statusIndex := indexOfString(statuses, status)
	if statusIndex < 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "status not found"})
		return
	}
	if len(statuses) <= 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one status is required"})
		return
	}
	nextStatuses := append([]string{}, statuses[:statusIndex]...)
	nextStatuses = append(nextStatuses, statuses[statusIndex+1:]...)
	fallback := nextStatuses[0]
	styles := normalizeClientTaskStatusStyles(nextStatuses, tab.StatusStyles)
	now := time.Now()
	if _, err := s.store.C("client_tabs").UpdateByID(c.Request.Context(), tab.ID, bson.M{"$set": bson.M{"statuses": nextStatuses, "status_styles": styles, "updated_at": now}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete status"})
		return
	}
	_, _ = s.store.C("client_tasks").UpdateMany(c.Request.Context(), bson.M{"tab_id": tab.ID, "status": status}, bson.M{"$set": bson.M{"status": fallback, "updated_at": now}})
	userCtx, _ := currentUser(c)
	s.broadcastClientTabChanged(c.Request.Context(), tab, userCtx.ID, "client_tab_status_deleted")
	c.JSON(http.StatusOK, gin.H{"deleted": true, "fallback_status": fallback, "statuses": nextStatuses, "status_styles": styles})
}

func (s *Server) deleteClientTab(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	s.deleteClientTaskNotificationsForFilter(c.Request.Context(), bson.M{"tab_id": tab.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"tab_id": tab.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"tab_id": tab.ID})
	if _, err := s.store.C("client_tabs").DeleteOne(c.Request.Context(), bson.M{"_id": tab.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete tab"})
		return
	}
	userCtx, _ := currentUser(c)
	s.broadcastClientTabChanged(c.Request.Context(), tab, userCtx.ID, "client_tab_deleted")
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) createClientTask(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	if tab.Type != "task_board" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tasks can only be added to task board tabs"})
		return
	}
	var req struct {
		Type        string                        `json:"type"`
		Title       string                        `json:"title"`
		Status      string                        `json:"status"`
		Content     string                        `json:"content"`
		URL         string                        `json:"url"`
		Comment     string                        `json:"comment"`
		PinX        *float64                      `json:"pin_x"`
		PinY        *float64                      `json:"pin_y"`
		PageWidth   int                           `json:"page_width"`
		PageHeight  int                           `json:"page_height"`
		Annotations []models.ClientTaskAnnotation `json:"annotations"`
		Attachments []string                      `json:"attachments"`
		Checklist   []models.ChecklistItem        `json:"checklist"`
		Blocks      []models.ClientTaskBlock      `json:"blocks"`
		AssigneeIDs []string                      `json:"assignee_ids"`
		DueDate     string                        `json:"due_date"`
		Recurrence  models.ClientTaskRecurrence   `json:"recurrence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task body"})
		return
	}
	taskType := strings.ToLower(strings.TrimSpace(req.Type))
	if taskType == "" {
		taskType = "description"
	}
	if taskType != "description" && taskType != "annotation" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task type must be description or annotation"})
		return
	}
	if !s.requireTeamFeatureAccess(c, tab.TeamID, "tasks") {
		return
	}
	if taskType == "annotation" && !s.requireTeamFeatureAccess(c, tab.TeamID, "annotations") {
		return
	}
	title := normalizeClientTaskTitle(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task title is required"})
		return
	}
	taskURL := strings.TrimSpace(req.URL)
	if taskType == "annotation" && !strings.HasPrefix(strings.ToLower(taskURL), "https://") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "annotation URL must start with https://"})
		return
	}
	status := normalizeClientTaskStatus(req.Status)
	if status == "" {
		status = "todo"
	}
	if !containsString(normalizeClientTaskStatuses(tab.Statuses), status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
		return
	}
	assigneeIDs, err := objectIDsFromStrings(req.AssigneeIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
		return
	}
	var client models.ClientProject
	_ = s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": tab.ClientID}).Decode(&client)
	var site models.ClientWebsite
	_ = s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": tab.WebsiteID}).Decode(&site)
	allowedAssignees := allowedClientTaskAssignees(client, site)
	for _, assigneeID := range assigneeIDs {
		if !containsObjectID(allowedAssignees, assigneeID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "assignee must have access to this domain"})
			return
		}
	}
	dueDate, err := parseOptionalDate(req.DueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid due date"})
		return
	}
	userCtx, _ := currentUser(c)
	now := time.Now()
	content := normalizeClientTaskContent(req.Content)
	checklist := normalizeClientTaskChecklist(req.Checklist)
	blocks := normalizeClientTaskBlocks(req.Blocks)
	if taskType == "description" {
		if len(blocks) == 0 {
			blocks = clientTaskBlocksFromLegacy(content, checklist)
		} else {
			if content == "" {
				content = firstClientTaskBlockContent(blocks)
			}
			if len(checklist) == 0 {
				checklist = flattenClientTaskBlockChecklist(blocks)
			}
		}
	}
	comment := normalizeClientTaskContent(req.Comment)
	if taskType == "annotation" {
		if comment == "" {
			comment = content
		}
		content = ""
		checklist = []models.ChecklistItem{}
		blocks = []models.ClientTaskBlock{}
	}
	var pinX *float64
	var pinY *float64
	if req.PinX != nil && req.PinY != nil {
		x := clampFloat(*req.PinX, 0, 100)
		y := clampFloat(*req.PinY, 0, 100)
		pinX = &x
		pinY = &y
	}
	pageWidth := 0
	pageHeight := 0
	if taskType == "annotation" {
		pageWidth = normalizeAnnotationPageDimension(req.PageWidth, 320, 8000)
		pageHeight = normalizeAnnotationPageDimension(req.PageHeight, 900, 50000)
	}
	attachments := compactStrings(req.Attachments)
	annotations := []models.ClientTaskAnnotation{}
	if taskType == "annotation" {
		initialAnnotation := models.ClientTaskAnnotation{
			Title:       title,
			URL:         taskURL,
			Comment:     comment,
			PinX:        pinX,
			PinY:        pinY,
			PageWidth:   pageWidth,
			PageHeight:  pageHeight,
			Attachments: attachments,
			AssigneeIDs: assigneeIDs,
			Status:      status,
		}
		sourceAnnotations := req.Annotations
		if len(sourceAnnotations) == 0 {
			sourceAnnotations = []models.ClientTaskAnnotation{initialAnnotation}
		}
		annotations = normalizeClientTaskAnnotations(sourceAnnotations, normalizeClientTaskStatuses(tab.Statuses), userCtx.ID, now)
	}
	task := models.ClientTask{
		ID:          primitive.NewObjectID(),
		ClientID:    tab.ClientID,
		WebsiteID:   tab.WebsiteID,
		TabID:       tab.ID,
		TeamID:      tab.TeamID,
		Type:        taskType,
		Title:       title,
		Content:     content,
		URL:         taskURL,
		Comment:     comment,
		PinX:        pinX,
		PinY:        pinY,
		PageWidth:   pageWidth,
		PageHeight:  pageHeight,
		Annotations: annotations,
		Attachments: attachments,
		Checklist:   checklist,
		Blocks:      blocks,
		AssigneeIDs: assigneeIDs,
		DueDate:     dueDate,
		Recurrence:  normalizeClientTaskRecurrence(req.Recurrence, dueDate),
		Status:      status,
		CreatedBy:   userCtx.ID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := s.store.C("client_tasks").InsertOne(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create task"})
		return
	}
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "created_task", "created this task")
	s.notifyClientTaskAssignees(c.Request.Context(), task)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_created")
	c.JSON(http.StatusCreated, gin.H{"task": task})
}

func (s *Server) listAssignedClientTasks(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
			return
		}
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}

	assignedOnly := strings.EqualFold(c.Query("scope"), "assigned") || strings.EqualFold(c.Query("view"), "assigned")
	access := s.clientAccessSets(c.Request.Context(), userCtx)
	clientFilter := bson.M{}
	if userCtx.Role != models.RoleOwnerAdmin {
		clientIDs := uniqueObjectIDs(append(append([]primitive.ObjectID{}, access.FullClientIDs...), access.DomainClientIDs...))
		if len(clientIDs) == 0 {
			c.JSON(http.StatusOK, gin.H{"tasks": []models.ClientTask{}, "clients": []models.ClientProject{}, "websites": []models.ClientWebsite{}, "tabs": []models.ClientTab{}, "members": []gin.H{}, "scope": "all", "can_create_tasks": false, "can_update_progress": true})
			return
		}
		clientFilter["_id"] = bson.M{"$in": clientIDs}
	}

	clientCursor, err := s.store.C("client_projects").Find(c.Request.Context(), clientFilter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load client folders"})
		return
	}
	defer clientCursor.Close(c.Request.Context())
	clients := []models.ClientProject{}
	if err := clientCursor.All(c.Request.Context(), &clients); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode client folders"})
		return
	}

	allowedClients := []models.ClientProject{}
	for _, client := range clients {
		allowedClients = append(allowedClients, client)
	}

	clientIDs := []primitive.ObjectID{}
	for _, client := range allowedClients {
		if !client.ID.IsZero() && !containsObjectID(clientIDs, client.ID) {
			clientIDs = append(clientIDs, client.ID)
		}
	}
	allowedTasks := []models.ClientTask{}
	if len(clientIDs) > 0 {
		taskAccessFilter := bson.M{"client_id": bson.M{"$in": clientIDs}}
		if userCtx.Role != models.RoleOwnerAdmin {
			or := []bson.M{}
			if len(access.FullClientIDs) > 0 {
				or = append(or, bson.M{"client_id": bson.M{"$in": access.FullClientIDs}})
			}
			if len(access.WebsiteIDs) > 0 {
				or = append(or, bson.M{"website_id": bson.M{"$in": access.WebsiteIDs}})
			}
			if len(or) == 0 {
				taskAccessFilter = bson.M{"_id": primitive.NewObjectID()}
			} else {
				taskAccessFilter = bson.M{"$or": or}
			}
		}
		taskFilter := taskAccessFilter
		if assignedOnly {
			taskFilter = bson.M{"$and": []bson.M{taskAccessFilter, {"assignee_ids": userCtx.ID}}}
		}
		cursor, err := s.store.C("client_tasks").Find(c.Request.Context(), taskFilter, options.Find().SetSort(bson.D{{Key: "due_date", Value: 1}, {Key: "created_at", Value: -1}}))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load tasks"})
			return
		}
		defer cursor.Close(c.Request.Context())
		if err := cursor.All(c.Request.Context(), &allowedTasks); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode tasks"})
			return
		}
	}

	websites := []models.ClientWebsite{}
	websiteIDs := []primitive.ObjectID{}
	if len(clientIDs) > 0 {
		siteFilter := bson.M{"client_id": bson.M{"$in": clientIDs}}
		if userCtx.Role != models.RoleOwnerAdmin {
			or := []bson.M{}
			if len(access.FullClientIDs) > 0 {
				or = append(or, bson.M{"client_id": bson.M{"$in": access.FullClientIDs}})
			}
			if len(access.WebsiteIDs) > 0 {
				or = append(or, bson.M{"_id": bson.M{"$in": access.WebsiteIDs}})
			}
			if len(or) == 0 {
				siteFilter = bson.M{"_id": primitive.NewObjectID()}
			} else {
				siteFilter = bson.M{"$or": or}
			}
		}
		siteCursor, err := s.store.C("client_websites").Find(c.Request.Context(), siteFilter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load domains"})
			return
		}
		defer siteCursor.Close(c.Request.Context())
		if err := siteCursor.All(c.Request.Context(), &websites); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode domains"})
			return
		}
	}
	for _, website := range websites {
		if !website.ID.IsZero() && !containsObjectID(websiteIDs, website.ID) {
			websiteIDs = append(websiteIDs, website.ID)
		}
	}

	tabs := []models.ClientTab{}
	if len(websiteIDs) > 0 {
		tabCursor, err := s.store.C("client_tabs").Find(c.Request.Context(), bson.M{"website_id": bson.M{"$in": websiteIDs}, "type": "task_board"}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load task boards"})
			return
		}
		defer tabCursor.Close(c.Request.Context())
		if err := tabCursor.All(c.Request.Context(), &tabs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode task boards"})
			return
		}
	}

	members := []gin.H{}
	seenMembers := map[primitive.ObjectID]bool{}
	for _, client := range allowedClients {
		for _, member := range s.clientProjectMembers(c.Request.Context(), client) {
			user, ok := member["user"].(models.User)
			if ok {
				if seenMembers[user.ID] {
					continue
				}
				seenMembers[user.ID] = true
			}
			members = append(members, member)
		}
	}
	for _, website := range websites {
		for _, member := range s.clientWebsiteMembers(c.Request.Context(), website) {
			user, ok := member["user"].(models.User)
			if ok {
				if seenMembers[user.ID] {
					continue
				}
				seenMembers[user.ID] = true
			}
			members = append(members, member)
		}
	}
	canCreateTasks := false
	for _, client := range allowedClients {
		if s.canManageClientProject(c.Request.Context(), userCtx, client) {
			canCreateTasks = true
			break
		}
	}
	if !canCreateTasks {
		for _, website := range websites {
			if s.canManageClientWebsite(c.Request.Context(), userCtx, website) {
				canCreateTasks = true
				break
			}
		}
	}
	scope := "all"
	if assignedOnly {
		scope = "assigned"
	}

	c.JSON(http.StatusOK, gin.H{
		"tasks":               allowedTasks,
		"clients":             allowedClients,
		"websites":            websites,
		"tabs":                tabs,
		"members":             members,
		"scope":               scope,
		"can_create_tasks":    canCreateTasks,
		"can_update_progress": true,
	})
}

func (s *Server) getClientTask(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, false)
	if !ok {
		return
	}
	var client models.ClientProject
	_ = s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": task.ClientID}).Decode(&client)
	var website models.ClientWebsite
	_ = s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": task.WebsiteID}).Decode(&website)
	var tab models.ClientTab
	_ = s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab)
	comments, _ := s.clientTaskComments(c.Request.Context(), task.ID)
	logs, _ := s.clientTaskLogs(c.Request.Context(), task.ID)
	members := s.mergeMemberRows(s.clientProjectMembers(c.Request.Context(), client), s.clientWebsiteMembers(c.Request.Context(), website))
	userCtx, _ := currentUser(c)
	c.JSON(http.StatusOK, gin.H{
		"task":                task,
		"client":              client,
		"website":             website,
		"tab":                 tab,
		"comments":            comments,
		"logs":                logs,
		"log_users":           s.clientTaskLogUsers(c.Request.Context(), logs),
		"members":             members,
		"can_manage":          s.canManageClientProject(c.Request.Context(), userCtx, client),
		"can_manage_task":     s.canManageClientTask(c.Request.Context(), userCtx, task),
		"can_update_progress": true,
		"can_manage_statuses": s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID),
	})
}

func (s *Server) updateClientTask(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, false)
	if !ok {
		return
	}
	var req struct {
		Title       *string                        `json:"title"`
		Content     *string                        `json:"content"`
		URL         *string                        `json:"url"`
		Comment     *string                        `json:"comment"`
		Status      *string                        `json:"status"`
		PageWidth   *int                           `json:"page_width"`
		PageHeight  *int                           `json:"page_height"`
		Annotations *[]models.ClientTaskAnnotation `json:"annotations"`
		Attachments []string                       `json:"attachments"`
		Checklist   []models.ChecklistItem         `json:"checklist"`
		Blocks      []models.ClientTaskBlock       `json:"blocks"`
		AssigneeIDs []string                       `json:"assignee_ids"`
		DueDate     *string                        `json:"due_date"`
		Recurrence  *models.ClientTaskRecurrence   `json:"recurrence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task update"})
		return
	}
	userCtx, _ := currentUser(c)
	hasContentChanges := req.Title != nil || req.Content != nil || req.URL != nil || req.Comment != nil || req.Attachments != nil || req.Annotations != nil
	if hasContentChanges && !s.canManageClientTask(c.Request.Context(), userCtx, task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the task creator or a folder admin can edit task wording"})
		return
	}
	now := time.Now()
	set := bson.M{"updated_at": now}
	activityLogs := []struct {
		action string
		detail string
	}{}
	effectiveDueDate := task.DueDate
	updatedTitle := task.Title
	var updatedAssigneeIDs []primitive.ObjectID
	assigneesChanged := false
	recurringCompleted := false
	recurringCompletionCount := task.CompletionCount
	if req.Title != nil {
		title := normalizeClientTaskTitle(*req.Title)
		if title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "task title is required"})
			return
		}
		updatedTitle = title
		set["title"] = title
	}
	if req.Content != nil {
		set["content"] = normalizeClientTaskContent(*req.Content)
	}
	if req.URL != nil {
		taskURL := strings.TrimSpace(*req.URL)
		if task.Type == "annotation" && !strings.HasPrefix(strings.ToLower(taskURL), "https://") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "annotation URL must start with https://"})
			return
		}
		set["url"] = taskURL
	}
	if req.Comment != nil {
		set["comment"] = normalizeClientTaskContent(*req.Comment)
	}
	if req.Status != nil {
		status := normalizeClientTaskStatus(*req.Status)
		if status == "" {
			status = "todo"
		}
		var tab models.ClientTab
		statuses := defaultClientTaskStatuses()
		if err := s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab); err == nil {
			statuses = normalizeClientTaskStatuses(tab.Statuses)
			if status != task.Status && !containsString(statuses, status) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
				return
			}
		}
		if clientTaskIsRecurring(task) && clientTaskIsDoneStatus(status) {
			recurringCompleted = true
			recurringCompletionCount = task.CompletionCount + 1
			resetStatus := clientTaskResetStatus(statuses)
			activityLogs = append(activityLogs, struct {
				action string
				detail string
			}{"completed_recurrence", "completed " + strconv.Itoa(recurringCompletionCount) + "x and reset from " + clientTaskStatusLogLabel(task.Status) + " to " + clientTaskStatusLogLabel(resetStatus)})
			set["status"] = resetStatus
			set["completion_count"] = recurringCompletionCount
			set["last_completed_at"] = now
			if nextDueDate := nextClientTaskRecurringDueDate(effectiveDueDate, task.Recurrence, now); nextDueDate != nil {
				effectiveDueDate = nextDueDate
				set["due_date"] = nextDueDate
			}
		} else {
			if status != task.Status {
				activityLogs = append(activityLogs, struct {
					action string
					detail string
				}{"updated_status", "changed status from " + clientTaskStatusLogLabel(task.Status) + " to " + clientTaskStatusLogLabel(status)})
			}
			set["status"] = status
		}
	}
	if task.Type == "annotation" && req.PageWidth != nil {
		set["page_width"] = normalizeAnnotationPageDimension(*req.PageWidth, 320, 8000)
	}
	if task.Type == "annotation" && req.PageHeight != nil {
		set["page_height"] = normalizeAnnotationPageDimension(*req.PageHeight, 900, 50000)
	}
	if task.Type == "annotation" && req.Annotations != nil {
		var tab models.ClientTab
		_ = s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab)
		set["annotations"] = normalizeClientTaskAnnotations(*req.Annotations, normalizeClientTaskStatuses(tab.Statuses), userCtx.ID, time.Now())
	}
	if req.Attachments != nil {
		set["attachments"] = compactStrings(req.Attachments)
	}
	if req.Checklist != nil {
		set["checklist"] = normalizeClientTaskChecklist(req.Checklist)
	}
	if req.Blocks != nil {
		blocks := normalizeClientTaskBlocks(req.Blocks)
		set["blocks"] = blocks
		set["checklist"] = flattenClientTaskBlockChecklist(blocks)
		if req.Content == nil && task.Type != "annotation" {
			set["content"] = normalizeClientTaskContent(firstClientTaskBlockContent(blocks))
		}
	}
	if req.AssigneeIDs != nil {
		assignees, err := objectIDsFromStrings(req.AssigneeIDs)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
			return
		}
		var client models.ClientProject
		if err := s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": task.ClientID}).Decode(&client); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "client folder not found"})
			return
		}
		var site models.ClientWebsite
		_ = s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": task.WebsiteID}).Decode(&site)
		allowedAssignees := allowedClientTaskAssignees(client, site)
		for _, assigneeID := range assignees {
			if !containsObjectID(allowedAssignees, assigneeID) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "assignee must have access to this domain"})
				return
			}
		}
		if !sameObjectIDSet(task.AssigneeIDs, assignees) {
			updatedAssigneeIDs = assignees
			assigneesChanged = true
			activityLogs = append(activityLogs, struct {
				action string
				detail string
			}{"updated_assignment", "updated assignment"})
		}
		set["assignee_ids"] = assignees
	}
	if req.DueDate != nil {
		due, err := parseOptionalDate(*req.DueDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid due date"})
			return
		}
		effectiveDueDate = due
		set["due_date"] = due
	}
	if req.Recurrence != nil {
		set["recurrence"] = normalizeClientTaskRecurrence(*req.Recurrence, effectiveDueDate)
	}
	if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update task"})
		return
	}
	for _, entry := range activityLogs {
		s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, entry.action, entry.detail)
	}
	notificationTask := task
	if updatedTitle != "" {
		notificationTask.Title = updatedTitle
	}
	if assigneesChanged {
		notificationTask.AssigneeIDs = updatedAssigneeIDs
	}
	if recurringCompleted {
		notificationTask.Status = "todo"
		notificationTask.CompletionCount = recurringCompletionCount
		notificationTask.LastCompletedAt = &now
	}
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	newAssignees := []primitive.ObjectID{}
	if assigneesChanged {
		removedAssignees := removedObjectIDs(task.AssigneeIDs, updatedAssigneeIDs)
		s.deleteNotificationsForUsers(c.Request.Context(), removedAssignees, task.ID, "client_task_assigned")
		for _, assigneeID := range updatedAssigneeIDs {
			if !containsObjectID(task.AssigneeIDs, assigneeID) {
				newAssignees = append(newAssignees, assigneeID)
			}
		}
		s.notifyUserIDs(c.Request.Context(), newAssignees, userCtx.ID, "client_task_assigned", actor+" assigned you a client task: "+notificationTask.Title, task.ID)
	}
	if recurringCompleted {
		recipients := withoutObjectIDs(s.clientTaskNotificationRecipients(c.Request.Context(), notificationTask), newAssignees)
		s.notifyUserIDs(c.Request.Context(), recipients, userCtx.ID, "client_task_updated", actor+" completed recurring task "+strconv.Itoa(recurringCompletionCount)+"x: "+notificationTask.Title, task.ID)
	} else if len(set) > 1 || req.Recurrence != nil {
		recipients := withoutObjectIDs(s.clientTaskNotificationRecipients(c.Request.Context(), notificationTask), newAssignees)
		s.notifyUserIDs(c.Request.Context(), recipients, userCtx.ID, "client_task_updated", actor+" updated task: "+notificationTask.Title, task.ID)
	}
	s.broadcastClientTaskChanged(c.Request.Context(), notificationTask, userCtx.ID, "client_task_updated")
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteClientTask(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, true)
	if !ok {
		return
	}
	comments, _ := s.clientTaskComments(c.Request.Context(), task.ID)
	relatedIDs := []primitive.ObjectID{task.ID}
	for _, url := range task.Attachments {
		s.deleteLocalUploadFile(url)
	}
	for _, comment := range comments {
		relatedIDs = append(relatedIDs, comment.ID)
		s.deleteLocalUploadFile(comment.AttachmentURL)
	}
	s.deleteNotificationsByRelatedIDs(c.Request.Context(), relatedIDs, clientTaskNotificationTypes...)
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
	_, _ = s.store.C("client_task_logs").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
	if _, err := s.store.C("client_tasks").DeleteOne(c.Request.Context(), bson.M{"_id": task.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete task"})
		return
	}
	userCtx, _ := currentUser(c)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_deleted")
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) updateClientTaskAnnotationStatus(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, false)
	if !ok {
		return
	}
	annotationID, err := objectIDFromString(c.Param("annotation_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation id"})
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation status update"})
		return
	}
	status := normalizeClientTaskStatus(req.Status)
	if status == "" {
		status = "todo"
	}
	var tab models.ClientTab
	if err := s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task board not found"})
		return
	}
	if !containsString(normalizeClientTaskStatuses(tab.Statuses), status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
		return
	}
	annotations := append([]models.ClientTaskAnnotation{}, task.Annotations...)
	found := false
	oldStatus := task.Status
	now := time.Now()
	for index := range annotations {
		if annotations[index].ID == annotationID {
			oldStatus = annotations[index].Status
			annotations[index].Status = status
			annotations[index].UpdatedAt = now
			found = true
			break
		}
	}
	if !found && annotationID == task.ID {
		if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": bson.M{"status": status, "updated_at": now}}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update annotation status"})
			return
		}
		userCtx, _ := currentUser(c)
		s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "updated_status", "changed annotation status from "+clientTaskStatusLogLabel(oldStatus)+" to "+clientTaskStatusLogLabel(status))
		actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
		s.notifyUserIDs(c.Request.Context(), s.clientTaskNotificationRecipients(c.Request.Context(), task), userCtx.ID, "client_task_updated", actor+" updated annotation status on: "+task.Title, task.ID)
		s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_updated")
		c.JSON(http.StatusOK, gin.H{"status": status, "annotations": annotations})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "annotation not found"})
		return
	}
	if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": bson.M{"annotations": annotations, "updated_at": now}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update annotation status"})
		return
	}
	userCtx, _ := currentUser(c)
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "updated_status", "changed annotation status from "+clientTaskStatusLogLabel(oldStatus)+" to "+clientTaskStatusLogLabel(status))
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	s.notifyUserIDs(c.Request.Context(), s.clientTaskNotificationRecipients(c.Request.Context(), task), userCtx.ID, "client_task_updated", actor+" updated annotation status on: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_updated")
	c.JSON(http.StatusOK, gin.H{"status": status, "annotations": annotations})
}

func (s *Server) createClientTaskComment(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, false)
	if !ok {
		return
	}
	var req struct {
		Content        string `json:"content"`
		ReplyToID      string `json:"reply_to_id"`
		ReplyText      string `json:"reply_text"`
		AttachmentURL  string `json:"attachment_url"`
		AttachmentName string `json:"attachment_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment body"})
		return
	}
	content := strings.TrimSpace(req.Content)
	attachmentURL := strings.TrimSpace(req.AttachmentURL)
	attachmentName := strings.TrimSpace(req.AttachmentName)
	if content == "" && attachmentURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comment or attachment is required"})
		return
	}
	replyToID := primitive.NilObjectID
	if strings.TrimSpace(req.ReplyToID) != "" {
		id, err := objectIDFromString(req.ReplyToID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reply_to_id"})
			return
		}
		replyToID = id
	}
	userCtx, _ := currentUser(c)
	comment := models.ClientTaskComment{
		ID:             primitive.NewObjectID(),
		TaskID:         task.ID,
		ClientID:       task.ClientID,
		WebsiteID:      task.WebsiteID,
		TabID:          task.TabID,
		TeamID:         task.TeamID,
		AuthorID:       userCtx.ID,
		Content:        content,
		ReplyToID:      replyToID,
		ReplyText:      strings.TrimSpace(req.ReplyText),
		AttachmentURL:  attachmentURL,
		AttachmentName: attachmentName,
		ReadBy:         []primitive.ObjectID{userCtx.ID},
		CreatedAt:      time.Now(),
	}
	if _, err := s.store.C("client_task_comments").InsertOne(c.Request.Context(), comment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create comment"})
		return
	}
	detail := "created a comment"
	if attachmentURL != "" {
		name := attachmentName
		if name == "" {
			name = filepath.Base(attachmentURL)
		}
		detail = "created a comment with attachment " + name
	}
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "created_comment", detail)
	mentionedIDs := s.notifyClientTaskCommentMentions(c.Request.Context(), task, userCtx.ID, comment.Content, comment.ID)
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	recipients := withoutObjectIDs(s.clientTaskNotificationRecipients(c.Request.Context(), task), mentionedIDs)
	s.notifyUserIDs(c.Request.Context(), recipients, userCtx.ID, "client_task_comment", actor+" commented on task: "+task.Title, comment.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_comment")
	c.JSON(http.StatusCreated, gin.H{"comment": comment})
}

func (s *Server) updateClientTaskComment(c *gin.Context) {
	comment, task, ok := s.loadClientTaskCommentForAccess(c)
	if !ok {
		return
	}
	userCtx, _ := currentUser(c)
	if !s.canManageClientTask(c.Request.Context(), userCtx, task) && comment.AuthorID != userCtx.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the comment creator or a folder admin can edit this comment"})
		return
	}
	var req struct {
		Content        *string `json:"content"`
		AttachmentURL  *string `json:"attachment_url"`
		AttachmentName *string `json:"attachment_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment update"})
		return
	}
	set := bson.M{}
	if req.Content != nil {
		set["content"] = strings.TrimSpace(*req.Content)
	}
	if req.AttachmentURL != nil {
		set["attachment_url"] = strings.TrimSpace(*req.AttachmentURL)
	}
	if req.AttachmentName != nil {
		set["attachment_name"] = strings.TrimSpace(*req.AttachmentName)
	}
	if len(set) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}
	if _, err := s.store.C("client_task_comments").UpdateByID(c.Request.Context(), comment.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update comment"})
		return
	}
	if req.AttachmentURL != nil && strings.TrimSpace(*req.AttachmentURL) != comment.AttachmentURL {
		s.deleteLocalUploadFile(comment.AttachmentURL)
	}
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "edited_comment", "edited a comment")
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	s.notifyUserIDs(c.Request.Context(), s.clientTaskNotificationRecipients(c.Request.Context(), task), userCtx.ID, "client_task_updated", actor+" edited a comment on task: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_comment_updated")
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteClientTaskComment(c *gin.Context) {
	comment, task, ok := s.loadClientTaskCommentForAccess(c)
	if !ok {
		return
	}
	userCtx, _ := currentUser(c)
	if !s.canManageClientTask(c.Request.Context(), userCtx, task) && comment.AuthorID != userCtx.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the comment creator or a folder admin can delete this comment"})
		return
	}
	if _, err := s.store.C("client_task_comments").DeleteOne(c.Request.Context(), bson.M{"_id": comment.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete comment"})
		return
	}
	s.deleteNotificationsByRelatedIDs(c.Request.Context(), []primitive.ObjectID{comment.ID}, "client_task_comment", "client_task_comment_mention", "client_task_comment_reaction")
	s.deleteLocalUploadFile(comment.AttachmentURL)
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "deleted_comment", "deleted a comment")
	actor := s.notificationActorName(c.Request.Context(), userCtx.ID)
	s.notifyUserIDs(c.Request.Context(), s.clientTaskNotificationRecipients(c.Request.Context(), task), userCtx.ID, "client_task_updated", actor+" deleted a comment on task: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_comment_deleted")
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) toggleClientTaskCommentReaction(c *gin.Context) {
	comment, task, ok := s.loadClientTaskCommentForAccess(c)
	if !ok {
		return
	}
	var req struct {
		Emoji string `json:"emoji"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reaction body"})
		return
	}
	emoji := strings.TrimSpace(req.Emoji)
	if emoji == "" || len([]rune(emoji)) > 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid emoji"})
		return
	}
	userCtx, _ := currentUser(c)
	reactions := make([]models.ClientTaskCommentReaction, 0, len(comment.Reactions)+1)
	found := false
	addedReaction := false
	removedReaction := false
	for _, reaction := range comment.Reactions {
		if strings.TrimSpace(reaction.Emoji) == "" {
			continue
		}
		userIDs := uniqueObjectIDs(reaction.UserIDs)
		if reaction.Emoji == emoji {
			found = true
			nextUserIDs := make([]primitive.ObjectID, 0, len(userIDs)+1)
			if containsObjectID(userIDs, userCtx.ID) {
				removedReaction = true
				for _, id := range userIDs {
					if id != userCtx.ID {
						nextUserIDs = append(nextUserIDs, id)
					}
				}
			} else {
				nextUserIDs = append(userIDs, userCtx.ID)
				addedReaction = true
			}
			userIDs = uniqueObjectIDs(nextUserIDs)
		}
		if len(userIDs) > 0 {
			reactions = append(reactions, models.ClientTaskCommentReaction{Emoji: reaction.Emoji, UserIDs: userIDs})
		}
	}
	if !found {
		addedReaction = true
		reactions = append(reactions, models.ClientTaskCommentReaction{Emoji: emoji, UserIDs: []primitive.ObjectID{userCtx.ID}})
	}
	if _, err := s.store.C("client_task_comments").UpdateByID(c.Request.Context(), comment.ID, bson.M{"$set": bson.M{"reactions": reactions}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update reaction"})
		return
	}
	if addedReaction && comment.AuthorID != userCtx.ID {
		actor := s.notificationActorMention(c.Request.Context(), userCtx.ID)
		s.notifyUserIDs(c.Request.Context(), []primitive.ObjectID{comment.AuthorID}, userCtx.ID, "client_task_comment_reaction", actor+" has given reaction "+clientReactionLabel(emoji)+" to your comment", comment.ID)
	}
	if removedReaction {
		s.deleteClientCommentReactionNotification(c.Request.Context(), comment, userCtx.ID, emoji)
	}
	s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_comment_reaction")
	c.JSON(http.StatusOK, gin.H{"reactions": reactions})
}

func (s *Server) markClientTaskCommentRead(c *gin.Context) {
	comment, _, ok := s.loadClientTaskCommentForAccess(c)
	if !ok {
		return
	}
	userCtx, _ := currentUser(c)
	if _, err := s.store.C("client_task_comments").UpdateByID(c.Request.Context(), comment.ID, bson.M{"$addToSet": bson.M{"read_by": userCtx.ID}}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not mark comment as read"})
		return
	}
	_, _ = s.store.C("notifications").UpdateMany(c.Request.Context(), bson.M{"user_id": userCtx.ID, "related_id": comment.ID}, bson.M{"$set": bson.M{"read": true}})
	unreadCount := s.unreadTaskCommentCount(c.Request.Context(), userCtx.ID, userCtx.TeamID)
	c.JSON(http.StatusOK, gin.H{"read": true, "unread_count": unreadCount})
}

func (s *Server) personalWorkspaceTeam(c *gin.Context) (models.Team, bool) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return models.Team{}, false
	}
	if user.Role == models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "owner admin does not have a client workspace"})
		return models.Team{}, false
	}
	team, err := s.personalTeamForUser(c.Request.Context(), user, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare personal workspace"})
		return models.Team{}, false
	}
	return team, true
}

func (s *Server) loadClientProjectForAccess(c *gin.Context, id primitive.ObjectID, manage bool) (models.ClientProject, bool) {
	userCtx, _ := currentUser(c)
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
			return models.ClientProject{}, false
		}
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&client); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client folder not found"})
		return models.ClientProject{}, false
	}
	if manage {
		if s.canManageClientProject(c.Request.Context(), userCtx, client) {
			return client, true
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "client folder management denied"})
		return models.ClientProject{}, false
	}
	if s.canManageClientProject(c.Request.Context(), userCtx, client) || containsObjectID(client.MemberIDs, userCtx.ID) || containsObjectID(client.ClientAdminIDs, userCtx.ID) {
		return client, true
	}
	if s.canAccessAnyClientWebsite(c.Request.Context(), userCtx, client.ID) {
		return client, true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "client folder access denied"})
	return models.ClientProject{}, false
}

func (s *Server) loadClientWebsiteForAccess(c *gin.Context, id primitive.ObjectID, manage bool) (models.ClientWebsite, bool) {
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return models.ClientWebsite{}, false
	}
	userCtx, _ := currentUser(c)
	if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
			return models.ClientWebsite{}, false
		}
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}
	if manage {
		if s.canManageClientWebsite(c.Request.Context(), userCtx, site) {
			return site, true
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "website management denied"})
		return models.ClientWebsite{}, false
	}
	if s.canAccessClientWebsite(c.Request.Context(), userCtx, site) {
		return site, true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "website access denied"})
	return models.ClientWebsite{}, false
}

func (s *Server) loadClientTabForAccess(c *gin.Context, manage bool) (models.ClientTab, bool) {
	tabID, ok := objectIDParam(c, "id")
	if !ok {
		return models.ClientTab{}, false
	}
	var tab models.ClientTab
	if err := s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": tabID}).Decode(&tab); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tab not found"})
		return models.ClientTab{}, false
	}
	if _, ok := s.loadClientWebsiteForAccess(c, tab.WebsiteID, manage); !ok {
		return models.ClientTab{}, false
	}
	return tab, true
}

func (s *Server) loadClientTaskForAccess(c *gin.Context, manage bool) (models.ClientTask, bool) {
	taskID, ok := objectIDParam(c, "id")
	if !ok {
		return models.ClientTask{}, false
	}
	var task models.ClientTask
	if err := s.store.C("client_tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return models.ClientTask{}, false
	}
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": task.WebsiteID}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return models.ClientTask{}, false
	}
	userCtx, _ := currentUser(c)
	if !s.canAccessClientWebsite(c.Request.Context(), userCtx, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "task access denied"})
		return models.ClientTask{}, false
	}
	if manage {
		if !s.canManageClientTask(c.Request.Context(), userCtx, task) {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the task creator or a folder admin can manage this task"})
			return models.ClientTask{}, false
		}
	}
	return task, true
}

func (s *Server) loadClientTaskCommentForAccess(c *gin.Context) (models.ClientTaskComment, models.ClientTask, bool) {
	commentID, ok := objectIDParam(c, "id")
	if !ok {
		return models.ClientTaskComment{}, models.ClientTask{}, false
	}
	var comment models.ClientTaskComment
	if err := s.store.C("client_task_comments").FindOne(c.Request.Context(), bson.M{"_id": commentID}).Decode(&comment); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
		return models.ClientTaskComment{}, models.ClientTask{}, false
	}
	var task models.ClientTask
	if err := s.store.C("client_tasks").FindOne(c.Request.Context(), bson.M{"_id": comment.TaskID}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return models.ClientTaskComment{}, models.ClientTask{}, false
	}
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": task.WebsiteID}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return models.ClientTaskComment{}, models.ClientTask{}, false
	}
	userCtx, _ := currentUser(c)
	if !s.canAccessClientWebsite(c.Request.Context(), userCtx, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "task access denied"})
		return models.ClientTaskComment{}, models.ClientTask{}, false
	}
	return comment, task, true
}

func (s *Server) canManageClientTask(ctx context.Context, userCtx middleware.UserContext, task models.ClientTask) bool {
	if task.CreatedBy == userCtx.ID {
		return true
	}
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": task.ClientID}).Decode(&client); err != nil {
		return false
	}
	if s.canManageClientProject(ctx, userCtx, client) {
		return true
	}
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(ctx, bson.M{"_id": task.WebsiteID}).Decode(&site); err != nil {
		return false
	}
	return containsObjectID(site.ClientAdminIDs, userCtx.ID)
}

func (s *Server) canManageClientProject(ctx context.Context, userCtx middleware.UserContext, client models.ClientProject) bool {
	return s.canManageTeamSilently(ctx, userCtx, client.TeamID) || containsObjectID(client.ClientAdminIDs, userCtx.ID)
}

func (s *Server) canAccessAnyClientWebsite(ctx context.Context, userCtx middleware.UserContext, clientID primitive.ObjectID) bool {
	if userCtx.Role == models.RoleOwnerAdmin {
		return true
	}
	count, err := s.store.C("client_websites").CountDocuments(ctx, bson.M{"client_id": clientID, "$or": []bson.M{
		{"member_ids": userCtx.ID},
		{"client_admin_ids": userCtx.ID},
		{"created_by": userCtx.ID},
	}})
	return err == nil && count > 0
}

func (s *Server) canAccessClientWebsite(ctx context.Context, userCtx middleware.UserContext, site models.ClientWebsite) bool {
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": site.ClientID}).Decode(&client); err != nil {
		return false
	}
	return s.canManageClientProject(ctx, userCtx, client) ||
		containsObjectID(client.MemberIDs, userCtx.ID) ||
		containsObjectID(client.ClientAdminIDs, userCtx.ID) ||
		containsObjectID(site.MemberIDs, userCtx.ID) ||
		containsObjectID(site.ClientAdminIDs, userCtx.ID) ||
		site.CreatedBy == userCtx.ID
}

func (s *Server) canManageClientWebsite(ctx context.Context, userCtx middleware.UserContext, site models.ClientWebsite) bool {
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": site.ClientID}).Decode(&client); err != nil {
		return false
	}
	return s.canManageClientProject(ctx, userCtx, client) || containsObjectID(site.ClientAdminIDs, userCtx.ID)
}

func (s *Server) canManageTeamSilently(ctx context.Context, userCtx middleware.UserContext, teamID primitive.ObjectID) bool {
	if user, err := s.loadUser(ctx, userCtx.ID); err == nil {
		if user.Status != models.StatusActive {
			return false
		}
		userCtx.Role = user.Role
		userCtx.TeamID = user.TeamID
	}
	if userCtx.Role == models.RoleOwnerAdmin || (userCtx.Role == models.RoleTeamAdmin && userCtx.TeamID == teamID) {
		return true
	}
	count, err := s.store.C("teams").CountDocuments(ctx, bson.M{"_id": teamID, "owner_admin_id": userCtx.ID})
	return err == nil && count > 0
}

func (s *Server) clientWebsites(ctx context.Context, clientID primitive.ObjectID) ([]models.ClientWebsite, error) {
	cursor, err := s.store.C("client_websites").Find(ctx, bson.M{"client_id": clientID}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var websites []models.ClientWebsite
	err = cursor.All(ctx, &websites)
	if websites == nil {
		websites = []models.ClientWebsite{}
	}
	return websites, err
}

func (s *Server) clientWebsitesForAccess(ctx context.Context, client models.ClientProject, userCtx middleware.UserContext) ([]models.ClientWebsite, error) {
	filter := bson.M{"client_id": client.ID}
	if !s.canManageClientProject(ctx, userCtx, client) && !containsObjectID(client.MemberIDs, userCtx.ID) && !containsObjectID(client.ClientAdminIDs, userCtx.ID) && client.CreatedBy != userCtx.ID {
		filter = bson.M{"client_id": client.ID, "$or": []bson.M{
			{"member_ids": userCtx.ID},
			{"client_admin_ids": userCtx.ID},
			{"created_by": userCtx.ID},
		}}
	}
	cursor, err := s.store.C("client_websites").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var websites []models.ClientWebsite
	err = cursor.All(ctx, &websites)
	if websites == nil {
		websites = []models.ClientWebsite{}
	}
	return websites, err
}

func (s *Server) clientDocuments(ctx context.Context, clientID primitive.ObjectID, websiteID primitive.ObjectID) ([]models.ClientDocument, error) {
	filter := bson.M{"client_id": clientID}
	if websiteID.IsZero() {
		filter["$or"] = []bson.M{{"website_id": bson.M{"$exists": false}}, {"website_id": primitive.NilObjectID}}
	} else {
		filter["website_id"] = websiteID
	}
	cursor, err := s.store.C("client_documents").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var docs []models.ClientDocument
	err = cursor.All(ctx, &docs)
	if docs == nil {
		docs = []models.ClientDocument{}
	}
	return docs, err
}

func (s *Server) clientTabs(ctx context.Context, websiteID primitive.ObjectID) ([]models.ClientTab, error) {
	cursor, err := s.store.C("client_tabs").Find(ctx, bson.M{"website_id": websiteID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var tabs []models.ClientTab
	err = cursor.All(ctx, &tabs)
	if tabs == nil {
		tabs = []models.ClientTab{}
	}
	return tabs, err
}

func (s *Server) clientTasks(ctx context.Context, websiteID primitive.ObjectID) ([]models.ClientTask, error) {
	cursor, err := s.store.C("client_tasks").Find(ctx, bson.M{"website_id": websiteID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var tasks []models.ClientTask
	err = cursor.All(ctx, &tasks)
	if tasks == nil {
		tasks = []models.ClientTask{}
	}
	return tasks, err
}

func (s *Server) clientTaskComments(ctx context.Context, taskID primitive.ObjectID) ([]models.ClientTaskComment, error) {
	cursor, err := s.store.C("client_task_comments").Find(ctx, bson.M{"task_id": taskID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var comments []models.ClientTaskComment
	err = cursor.All(ctx, &comments)
	if comments == nil {
		comments = []models.ClientTaskComment{}
	}
	return comments, err
}

func (s *Server) clientTaskLogs(ctx context.Context, taskID primitive.ObjectID) ([]models.ClientTaskLog, error) {
	cursor, err := s.store.C("client_task_logs").Find(ctx, bson.M{"task_id": taskID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var logs []models.ClientTaskLog
	err = cursor.All(ctx, &logs)
	if logs == nil {
		logs = []models.ClientTaskLog{}
	}
	return logs, err
}

func (s *Server) clientTaskLogUsers(ctx context.Context, logs []models.ClientTaskLog) []models.User {
	ids := []primitive.ObjectID{}
	for _, log := range logs {
		if !log.ActorID.IsZero() && !containsObjectID(ids, log.ActorID) {
			ids = append(ids, log.ActorID)
		}
	}
	if len(ids) == 0 {
		return []models.User{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
	if err != nil {
		return []models.User{}
	}
	defer cursor.Close(ctx)
	users := []models.User{}
	if cursor.All(ctx, &users) != nil {
		return []models.User{}
	}
	return users
}

func (s *Server) recordClientTaskLog(ctx context.Context, task models.ClientTask, actorID primitive.ObjectID, action string, detail string) {
	detail = strings.TrimSpace(detail)
	runes := []rune(detail)
	if len(runes) > 300 {
		detail = string(runes[:300])
	}
	log := models.ClientTaskLog{
		ID:        primitive.NewObjectID(),
		TaskID:    task.ID,
		ClientID:  task.ClientID,
		WebsiteID: task.WebsiteID,
		TabID:     task.TabID,
		TeamID:    task.TeamID,
		ActorID:   actorID,
		Action:    strings.TrimSpace(action),
		Detail:    detail,
		CreatedAt: time.Now(),
	}
	_, _ = s.store.C("client_task_logs").InsertOne(ctx, log)
}

func (s *Server) deleteLocalUploadFile(url string) {
	url = strings.TrimSpace(url)
	if !strings.HasPrefix(url, "/uploads/") {
		return
	}
	name := strings.TrimPrefix(url, "/uploads/")
	clean := filepath.Clean(name)
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return
	}
	base, err := filepath.Abs(s.cfg.UploadDir)
	if err != nil {
		return
	}
	target, err := filepath.Abs(filepath.Join(s.cfg.UploadDir, clean))
	if err != nil {
		return
	}
	rel, err := filepath.Rel(base, target)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return
	}
	_ = os.Remove(target)
}

func (s *Server) clientProjectMembers(ctx context.Context, client models.ClientProject) []gin.H {
	ids := uniqueObjectIDs(append(append([]primitive.ObjectID{}, client.MemberIDs...), client.ClientAdminIDs...))
	if len(ids) == 0 {
		return []gin.H{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return []gin.H{}
	}
	defer cursor.Close(ctx)
	rows := []gin.H{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) != nil {
			continue
		}
		role := clientAccessStaffRole(user.StaffRole, user)
		if containsObjectID(client.ClientAdminIDs, user.ID) {
			role = string(models.RoleClientAdmin)
		}
		rows = append(rows, gin.H{"user": user, "client_role": role, "staff_role": user.StaffRole, "role": user.Role})
	}
	return rows
}

func (s *Server) clientWebsiteMembers(ctx context.Context, site models.ClientWebsite) []gin.H {
	ids := uniqueObjectIDs(append(append([]primitive.ObjectID{}, site.MemberIDs...), site.ClientAdminIDs...))
	if len(ids) == 0 {
		return []gin.H{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return []gin.H{}
	}
	defer cursor.Close(ctx)
	rows := []gin.H{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) != nil {
			continue
		}
		role := clientAccessStaffRole(user.StaffRole, user)
		if containsObjectID(site.ClientAdminIDs, user.ID) {
			role = string(models.RoleClientAdmin)
		}
		rows = append(rows, gin.H{"user": user, "client_role": role, "staff_role": user.StaffRole, "role": user.Role})
	}
	return rows
}

func (s *Server) mergeMemberRows(groups ...[]gin.H) []gin.H {
	rows := []gin.H{}
	seen := map[primitive.ObjectID]bool{}
	for _, group := range groups {
		for _, row := range group {
			user, ok := row["user"].(models.User)
			if ok {
				if seen[user.ID] {
					continue
				}
				seen[user.ID] = true
			}
			rows = append(rows, row)
		}
	}
	return rows
}

func allowedClientTaskAssignees(client models.ClientProject, site models.ClientWebsite) []primitive.ObjectID {
	ids := []primitive.ObjectID{}
	ids = append(ids, client.MemberIDs...)
	ids = append(ids, client.ClientAdminIDs...)
	ids = append(ids, site.MemberIDs...)
	ids = append(ids, site.ClientAdminIDs...)
	ids = append(ids, client.CreatedBy, site.CreatedBy)
	return uniqueObjectIDs(ids)
}

func normalizeClientTaskTitle(value string) string {
	title := strings.TrimSpace(value)
	runes := []rune(title)
	if len(runes) > 80 {
		title = string(runes[:80])
	}
	return strings.TrimSpace(title)
}

func normalizeAnnotationPageDimension(value, min, max int) int {
	if value <= 0 {
		return 0
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func normalizeClientTaskAnnotations(values []models.ClientTaskAnnotation, statuses []string, actorID primitive.ObjectID, now time.Time) []models.ClientTaskAnnotation {
	out := []models.ClientTaskAnnotation{}
	for _, item := range values {
		title := normalizeClientTaskTitle(item.Title)
		comment := normalizeClientTaskContent(item.Comment)
		url := strings.TrimSpace(item.URL)
		if title == "" && comment != "" {
			title = normalizeClientTaskTitle(comment)
		}
		if title == "" {
			title = "Annotation"
		}
		if !strings.HasPrefix(strings.ToLower(url), "https://") {
			continue
		}
		if item.PinX == nil || item.PinY == nil {
			continue
		}
		x := clampFloat(*item.PinX, 0, 100)
		y := clampFloat(*item.PinY, 0, 100)
		status := normalizeClientTaskStatus(item.Status)
		if status == "" || !containsString(statuses, status) {
			status = "todo"
			if len(statuses) > 0 {
				status = statuses[0]
			}
		}
		id := item.ID
		if id.IsZero() {
			id = primitive.NewObjectID()
		}
		createdBy := item.CreatedBy
		if createdBy.IsZero() {
			createdBy = actorID
		}
		createdAt := item.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		out = append(out, models.ClientTaskAnnotation{
			ID:          id,
			Title:       title,
			URL:         url,
			Comment:     comment,
			PinX:        &x,
			PinY:        &y,
			PageWidth:   normalizeAnnotationPageDimension(item.PageWidth, 320, 8000),
			PageHeight:  normalizeAnnotationPageDimension(item.PageHeight, 900, 50000),
			Attachments: compactStrings(item.Attachments),
			AssigneeIDs: uniqueObjectIDs(item.AssigneeIDs),
			Status:      status,
			CreatedBy:   createdBy,
			CreatedAt:   createdAt,
			UpdatedAt:   now,
		})
		if len(out) >= 300 {
			break
		}
	}
	return out
}

func normalizeClientTaskContent(value string) string {
	content := strings.TrimSpace(value)
	runes := []rune(content)
	if len(runes) > 10000 {
		content = string(runes[:10000])
	}
	return strings.TrimSpace(content)
}

func normalizeClientTaskChecklist(values []models.ChecklistItem) []models.ChecklistItem {
	out := []models.ChecklistItem{}
	for _, item := range values {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}
		runes := []rune(text)
		if len(runes) > 180 {
			text = string(runes[:180])
		}
		out = append(out, models.ChecklistItem{Text: strings.TrimSpace(text), Done: item.Done})
		if len(out) >= 100 {
			break
		}
	}
	return out
}

func normalizeClientTaskBlocks(values []models.ClientTaskBlock) []models.ClientTaskBlock {
	out := []models.ClientTaskBlock{}
	for _, block := range values {
		blockType := strings.ToLower(strings.TrimSpace(block.Type))
		switch blockType {
		case "content", "note":
			content := normalizeClientTaskContent(block.Content)
			if content == "" {
				continue
			}
			out = append(out, models.ClientTaskBlock{Type: "content", Content: content})
		case "checklist":
			items := normalizeClientTaskChecklist(block.Checklist)
			if len(items) == 0 {
				continue
			}
			out = append(out, models.ClientTaskBlock{Type: "checklist", Checklist: items})
		}
		if len(out) >= 80 {
			break
		}
	}
	return out
}

func clientTaskBlocksFromLegacy(content string, checklist []models.ChecklistItem) []models.ClientTaskBlock {
	blocks := []models.ClientTaskBlock{}
	content = normalizeClientTaskContent(content)
	if content != "" {
		blocks = append(blocks, models.ClientTaskBlock{Type: "content", Content: content})
	}
	items := normalizeClientTaskChecklist(checklist)
	if len(items) > 0 {
		blocks = append(blocks, models.ClientTaskBlock{Type: "checklist", Checklist: items})
	}
	return blocks
}

func firstClientTaskBlockContent(blocks []models.ClientTaskBlock) string {
	for _, block := range blocks {
		if block.Type == "content" && strings.TrimSpace(block.Content) != "" {
			return block.Content
		}
	}
	return ""
}

func flattenClientTaskBlockChecklist(blocks []models.ClientTaskBlock) []models.ChecklistItem {
	items := []models.ChecklistItem{}
	for _, block := range blocks {
		if block.Type != "checklist" {
			continue
		}
		items = append(items, block.Checklist...)
		if len(items) >= 100 {
			return normalizeClientTaskChecklist(items[:100])
		}
	}
	return normalizeClientTaskChecklist(items)
}

func normalizeClientTaskRecurrence(value models.ClientTaskRecurrence, dueDate *time.Time) models.ClientTaskRecurrence {
	frequency := strings.ToLower(strings.TrimSpace(value.Frequency))
	switch frequency {
	case "", "none":
		return models.ClientTaskRecurrence{}
	case "daily", "weekly":
		return models.ClientTaskRecurrence{Frequency: frequency}
	case "monthly":
	default:
		return models.ClientTaskRecurrence{}
	}

	recurrence := models.ClientTaskRecurrence{Frequency: "monthly"}
	mode := strings.ToLower(strings.TrimSpace(value.MonthlyMode))
	if mode == "nth_weekday" {
		recurrence.MonthlyMode = "nth_weekday"
		ordinal := value.WeekOrdinal
		if ordinal != -1 && (ordinal < 1 || ordinal > 5) {
			ordinal = 1
			if dueDate != nil {
				ordinal = ((dueDate.Day() - 1) / 7) + 1
			}
		}
		weekday := value.Weekday
		if weekday < 0 || weekday > 6 {
			weekday = 1
			if dueDate != nil {
				weekday = int(dueDate.Weekday())
			}
		}
		recurrence.WeekOrdinal = ordinal
		recurrence.Weekday = weekday
		return recurrence
	}

	seen := map[int]bool{}
	for _, day := range value.MonthDates {
		if day >= 1 && day <= 31 {
			seen[day] = true
		}
	}
	if len(seen) == 0 && dueDate != nil {
		seen[dueDate.Day()] = true
	}
	if len(seen) == 0 {
		seen[1] = true
	}
	recurrence.MonthlyMode = "dates"
	recurrence.MonthDates = []int{}
	for day := 1; day <= 31; day++ {
		if seen[day] {
			recurrence.MonthDates = append(recurrence.MonthDates, day)
		}
	}
	return recurrence
}

func clientTaskStatusLogLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "todo"
	}
	return strings.ReplaceAll(value, "_", " ")
}

func clientTaskIsRecurring(task models.ClientTask) bool {
	frequency := strings.ToLower(strings.TrimSpace(task.Recurrence.Frequency))
	return frequency == "daily" || frequency == "weekly" || frequency == "monthly"
}

func clientTaskIsDoneStatus(status string) bool {
	status = normalizeClientTaskStatus(status)
	return status == "done" || status == "complete" || status == "completed" || status == "closed" || strings.Contains(status, "complete")
}

func clientTaskResetStatus(statuses []string) string {
	statuses = normalizeClientTaskStatuses(statuses)
	if containsString(statuses, "todo") {
		return "todo"
	}
	for _, status := range statuses {
		if !clientTaskIsDoneStatus(status) {
			return status
		}
	}
	if len(statuses) > 0 {
		return statuses[0]
	}
	return "todo"
}

func clientTaskDateOnly(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, value.Location())
}

func clientTaskMonthDay(year int, month time.Month, day int, loc *time.Location) (time.Time, bool) {
	if day < 1 || day > 31 {
		return time.Time{}, false
	}
	candidate := time.Date(year, month, day, 0, 0, 0, 0, loc)
	if candidate.Month() != month {
		return time.Time{}, false
	}
	return candidate, true
}

func clientTaskNthWeekday(year int, month time.Month, ordinal int, weekday time.Weekday, loc *time.Location) (time.Time, bool) {
	if ordinal == -1 {
		for day := 31; day >= 1; day-- {
			candidate, ok := clientTaskMonthDay(year, month, day, loc)
			if ok && candidate.Weekday() == weekday {
				return candidate, true
			}
		}
		return time.Time{}, false
	}
	if ordinal < 1 || ordinal > 5 {
		ordinal = 1
	}
	first := time.Date(year, month, 1, 0, 0, 0, 0, loc)
	offset := (int(weekday) - int(first.Weekday()) + 7) % 7
	day := 1 + offset + (ordinal-1)*7
	return clientTaskMonthDay(year, month, day, loc)
}

func nextClientTaskRecurringDueDate(currentDue *time.Time, recurrence models.ClientTaskRecurrence, completedAt time.Time) *time.Time {
	if currentDue == nil {
		return nil
	}
	due := clientTaskDateOnly(*currentDue)
	boundary := clientTaskDateOnly(completedAt.In(due.Location()))
	if due.After(boundary) {
		boundary = due
	}
	frequency := strings.ToLower(strings.TrimSpace(recurrence.Frequency))
	switch frequency {
	case "daily":
		next := due
		for !next.After(boundary) {
			next = next.AddDate(0, 0, 1)
		}
		return &next
	case "weekly":
		next := due
		for !next.After(boundary) {
			next = next.AddDate(0, 0, 7)
		}
		return &next
	case "monthly":
	default:
		return nil
	}
	loc := due.Location()
	for offset := 0; offset < 48; offset++ {
		cursor := time.Date(boundary.Year(), boundary.Month()+time.Month(offset), 1, 0, 0, 0, 0, loc)
		candidates := []time.Time{}
		if strings.EqualFold(strings.TrimSpace(recurrence.MonthlyMode), "nth_weekday") {
			ordinal := recurrence.WeekOrdinal
			if ordinal == 0 {
				ordinal = ((due.Day() - 1) / 7) + 1
			}
			weekday := time.Weekday(recurrence.Weekday)
			if recurrence.Weekday < 0 || recurrence.Weekday > 6 {
				weekday = due.Weekday()
			}
			if candidate, ok := clientTaskNthWeekday(cursor.Year(), cursor.Month(), ordinal, weekday, loc); ok {
				candidates = append(candidates, candidate)
			}
		} else {
			dates := recurrence.MonthDates
			if len(dates) == 0 {
				dates = []int{due.Day()}
			}
			for _, day := range dates {
				if candidate, ok := clientTaskMonthDay(cursor.Year(), cursor.Month(), day, loc); ok {
					candidates = append(candidates, candidate)
				}
			}
		}
		for _, candidate := range candidates {
			if candidate.After(boundary) && candidate.After(due) {
				next := candidate
				return &next
			}
		}
	}
	return nil
}

func sameObjectIDSet(a []primitive.ObjectID, b []primitive.ObjectID) bool {
	if len(a) != len(b) {
		return false
	}
	for _, id := range a {
		if !containsObjectID(b, id) {
			return false
		}
	}
	return true
}

func defaultClientTaskStatuses() []string {
	return []string{"todo", "in_progress", "done"}
}

func defaultClientTaskBoardTab(site models.ClientWebsite, actorID primitive.ObjectID, now time.Time) models.ClientTab {
	statuses := defaultClientTaskStatuses()
	return models.ClientTab{
		ID:        primitive.NewObjectID(),
		ClientID:  site.ClientID,
		WebsiteID: site.ID,
		TeamID:    site.TeamID,
		Type:      "task_board",
		Title:     "Task Board",
		Statuses:  statuses,
		CreatedBy: actorID,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func normalizeClientTaskStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case r == '_':
			if !lastUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	return strings.Trim(b.String(), "_")
}

func normalizeClientTaskStatuses(values []string) []string {
	out := []string{}
	seen := map[string]bool{}
	input := values
	if len(input) == 0 {
		input = defaultClientTaskStatuses()
	}
	for _, value := range input {
		status := normalizeClientTaskStatus(value)
		if status == "" || seen[status] {
			continue
		}
		seen[status] = true
		out = append(out, status)
	}
	return out
}

func (s *Server) canManageClientStatuses(c *gin.Context, tab models.ClientTab) bool {
	userCtx, _ := currentUser(c)
	if s.canManageTeamSilently(c.Request.Context(), userCtx, tab.TeamID) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "only user admins can manage board statuses"})
	return false
}

func indexOfString(values []string, needle string) int {
	for index, value := range values {
		if value == needle {
			return index
		}
	}
	return -1
}

func normalizeClientTaskStatusStyles(statuses []string, styles map[string]models.ClientTaskStatusStyle) map[string]models.ClientTaskStatusStyle {
	if len(styles) == 0 {
		return nil
	}
	allowed := map[string]bool{}
	for _, status := range normalizeClientTaskStatuses(statuses) {
		allowed[status] = true
	}
	out := map[string]models.ClientTaskStatusStyle{}
	for rawStatus, style := range styles {
		status := normalizeClientTaskStatus(rawStatus)
		if status == "" || !allowed[status] {
			continue
		}
		iconColor := normalizeHexColor(style.IconColor)
		textColor := normalizeHexColor(style.TextColor)
		if iconColor == "" && textColor == "" {
			continue
		}
		out[status] = models.ClientTaskStatusStyle{IconColor: iconColor, TextColor: textColor}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeHexColor(value string) string {
	value = strings.TrimSpace(value)
	if len(value) != 7 || !strings.HasPrefix(value, "#") {
		return ""
	}
	for _, r := range value[1:] {
		if !(r >= '0' && r <= '9') && !(r >= 'a' && r <= 'f') && !(r >= 'A' && r <= 'F') {
			return ""
		}
	}
	return strings.ToLower(value)
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func clientDocumentKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "google_doc":
		return "google_doc"
	case "file":
		return "file"
	case "image":
		return "image"
	default:
		return "note"
	}
}

func clientTabType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "doc_list":
		return "doc_list"
	case "task_board":
		return "task_board"
	default:
		return "description"
	}
}

func clientTabDefaultTitle(tabType string) string {
	switch tabType {
	case "doc_list":
		return "Documents"
	case "task_board":
		return "Tasks"
	default:
		return "Description"
	}
}

func normalizeOptionalURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(strings.ToLower(value), "http://") || strings.HasPrefix(strings.ToLower(value), "https://") {
		return value
	}
	return "https://" + value
}

func compactStrings(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func (s *Server) notifyClientTaskAssignees(ctx context.Context, task models.ClientTask) {
	if len(task.AssigneeIDs) == 0 {
		return
	}
	actor := "A user"
	if user, err := s.loadUser(ctx, task.CreatedBy); err == nil {
		actor = firstNonEmpty(user.Name, user.Username, user.Email, actor)
	}
	now := time.Now()
	for _, assigneeID := range s.userNotificationRecipients(ctx, task.AssigneeIDs, task.CreatedBy) {
		s.insertNotification(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    assigneeID,
			Type:      "client_task_assigned",
			Content:   actor + " assigned you a client task: " + task.Title,
			RelatedID: task.ID,
			Read:      false,
			CreatedAt: now,
		})
	}
}

func (s *Server) clientTaskNotificationRecipients(ctx context.Context, task models.ClientTask) []primitive.ObjectID {
	recipients := append([]primitive.ObjectID{}, task.AssigneeIDs...)
	recipients = append(recipients, task.CreatedBy)
	var client models.ClientProject
	if s.store.C("client_projects").FindOne(ctx, bson.M{"_id": task.ClientID}).Decode(&client) == nil {
		recipients = append(recipients, client.MemberIDs...)
		recipients = append(recipients, client.ClientAdminIDs...)
		recipients = append(recipients, client.CreatedBy)
	}
	return uniqueObjectIDs(recipients)
}

func withoutObjectIDs(ids []primitive.ObjectID, excluded []primitive.ObjectID) []primitive.ObjectID {
	excludedMap := map[primitive.ObjectID]bool{}
	for _, id := range excluded {
		excludedMap[id] = true
	}
	out := []primitive.ObjectID{}
	for _, id := range ids {
		if !id.IsZero() && !excludedMap[id] {
			out = append(out, id)
		}
	}
	return uniqueObjectIDs(out)
}

func clientReactionLabel(emoji string) string {
	switch strings.TrimSpace(emoji) {
	case "👍":
		return "thumbs up (👍)"
	case "🙏":
		return "thanks (🙏)"
	case "🔥":
		return "fire (🔥)"
	case "✅":
		return "done (✅)"
	case "🎉":
		return "celebration (🎉)"
	case "💡":
		return "idea (💡)"
	case "👀":
		return "eyes (👀)"
	case "❤️":
		return "heart (❤️)"
	default:
		if strings.TrimSpace(emoji) == "" {
			return "to your comment"
		}
		return emoji
	}
}

func (s *Server) notifyClientTaskCommentMentions(ctx context.Context, task models.ClientTask, actorID primitive.ObjectID, content string, commentID primitive.ObjectID) []primitive.ObjectID {
	names := mentionPattern.FindAllStringSubmatch(content, -1)
	if len(names) == 0 {
		return nil
	}
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": task.ClientID}).Decode(&client); err != nil {
		s.notifyMentions(ctx, task.TeamID, actorID, content, "client_task_comment", commentID)
		return nil
	}
	allowedIDs := uniqueObjectIDs(append(append([]primitive.ObjectID{}, client.MemberIDs...), client.ClientAdminIDs...))
	if len(allowedIDs) == 0 {
		return nil
	}
	seenNames := map[string]bool{}
	usernames := []string{}
	for _, match := range names {
		username := strings.ToLower(match[1])
		if !seenNames[username] {
			seenNames[username] = true
			usernames = append(usernames, username)
		}
	}
	actor := "Someone"
	if actorUser, err := s.loadUser(ctx, actorID); err == nil {
		s.ensureUserIdentity(ctx, &actorUser)
		actor = "@" + actorUser.Username
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": allowedIDs}, "username": bson.M{"$in": usernames}, "status": models.StatusActive, "role": bson.M{"$ne": models.RoleOwnerAdmin}})
	if err != nil {
		return nil
	}
	defer cursor.Close(ctx)
	mentionedIDs := []primitive.ObjectID{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) != nil || user.ID == actorID {
			continue
		}
		mentionedIDs = append(mentionedIDs, user.ID)
		s.insertNotification(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    user.ID,
			Type:      "client_task_comment_mention",
			Content:   actor + " mentioned you: " + trimForNotification(content),
			RelatedID: commentID,
			Read:      false,
			CreatedAt: time.Now(),
		})
	}
	return uniqueObjectIDs(mentionedIDs)
}
