package handlers

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
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
	filter := bson.M{}
	if userCtx.Role != models.RoleOwnerAdmin {
		or := []bson.M{{"member_ids": userCtx.ID}, {"client_admin_ids": userCtx.ID}}
		actualRole := userCtx.Role
		if user, err := s.loadUser(c.Request.Context(), userCtx.ID); err == nil {
			if user.Status != models.StatusActive {
				c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
				return
			}
			actualRole = user.Role
		}
		if actualRole != models.RoleClientAdmin {
			if team, ok := s.personalWorkspaceTeam(c); ok {
				or = append(or, bson.M{"team_id": team.ID})
			}
		}
		filter = bson.M{"$or": or}
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
		siteCursor, err := s.store.C("client_websites").Find(c.Request.Context(), bson.M{"client_id": bson.M{"$in": clientIDs}}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
		if err == nil {
			defer siteCursor.Close(c.Request.Context())
			_ = siteCursor.All(c.Request.Context(), &websites)
		}
	}
	c.JSON(http.StatusOK, gin.H{"clients": clients, "websites": websites})
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
	websites, _ := s.clientWebsites(c.Request.Context(), client.ID)
	documents, _ := s.clientDocuments(c.Request.Context(), client.ID, primitive.NilObjectID)
	members := s.clientProjectMembers(c.Request.Context(), client)
	userCtx, _ := currentUser(c)
	c.JSON(http.StatusOK, gin.H{
		"client":             client,
		"websites":           websites,
		"documents":          documents,
		"members":            members,
		"can_manage":         s.canManageClientProject(c.Request.Context(), userCtx, client),
		"can_manage_members": s.canManageTeamSilently(c.Request.Context(), userCtx, client.TeamID),
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
	client, ok := s.loadClientProjectForAccess(c, clientID, true)
	if !ok {
		return
	}
	if _, err := s.store.C("client_projects").DeleteOne(c.Request.Context(), bson.M{"_id": client.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete client"})
		return
	}
	_, _ = s.store.C("client_websites").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_documents").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_tabs").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"client_id": client.ID})
	c.JSON(http.StatusOK, gin.H{"deleted": true})
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
	role := strings.ToLower(strings.TrimSpace(req.Role))
	targetRole := "member"
	update := bson.M{"$addToSet": bson.M{"member_ids": memberID}, "$pull": bson.M{"client_admin_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	if role == string(models.RoleClientAdmin) {
		targetRole = string(models.RoleClientAdmin)
		update = bson.M{"$addToSet": bson.M{"client_admin_ids": memberID}, "$pull": bson.M{"member_ids": memberID}, "$set": bson.M{"updated_at": time.Now()}}
	}
	alreadyTargetRole := (targetRole == string(models.RoleClientAdmin) && containsObjectID(client.ClientAdminIDs, memberID)) || (targetRole == "member" && containsObjectID(client.MemberIDs, memberID))
	alreadyHadAccess := containsObjectID(client.ClientAdminIDs, memberID) || containsObjectID(client.MemberIDs, memberID)
	if _, err := s.store.C("client_projects").UpdateByID(c.Request.Context(), client.ID, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not add member"})
		return
	}
	if !alreadyTargetRole && member.ID != userCtx.ID {
		roleName := "Member"
		notificationType := "client_project_added"
		content := "You were added to " + client.Name + " as " + roleName + "."
		if targetRole == string(models.RoleClientAdmin) {
			roleName = "Client Admin"
			content = "You were added to " + client.Name + " as " + roleName + "."
		}
		if alreadyHadAccess {
			notificationType = "client_project_role_updated"
			content = "Your access to " + client.Name + " was updated to " + roleName + "."
		}
		_, _ = s.store.C("notifications").InsertOne(c.Request.Context(), models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    memberID,
			Type:      notificationType,
			Content:   content,
			RelatedID: client.ID,
			Read:      false,
			CreatedAt: time.Now(),
		})
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
	c.JSON(http.StatusCreated, gin.H{"website": site})
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
	members := s.clientProjectMembers(c.Request.Context(), client)
	userCtx, _ := currentUser(c)
	c.JSON(http.StatusOK, gin.H{
		"client":              client,
		"website":             site,
		"tabs":                tabs,
		"documents":           documents,
		"tasks":               tasks,
		"members":             members,
		"can_manage":          s.canManageClientProject(c.Request.Context(), userCtx, client),
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
	_, _ = s.store.C("client_tabs").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"website_id": site.ID})
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
	c.JSON(http.StatusOK, gin.H{"deleted": true, "fallback_status": fallback, "statuses": nextStatuses, "status_styles": styles})
}

func (s *Server) deleteClientTab(c *gin.Context) {
	tab, ok := s.loadClientTabForAccess(c, true)
	if !ok {
		return
	}
	_, _ = s.store.C("client_tasks").DeleteMany(c.Request.Context(), bson.M{"tab_id": tab.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"tab_id": tab.ID})
	if _, err := s.store.C("client_tabs").DeleteOne(c.Request.Context(), bson.M{"_id": tab.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete tab"})
		return
	}
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
		Type        string                      `json:"type"`
		Title       string                      `json:"title"`
		Content     string                      `json:"content"`
		URL         string                      `json:"url"`
		Comment     string                      `json:"comment"`
		PinX        *float64                    `json:"pin_x"`
		PinY        *float64                    `json:"pin_y"`
		Attachments []string                    `json:"attachments"`
		Checklist   []models.ChecklistItem      `json:"checklist"`
		AssigneeIDs []string                    `json:"assignee_ids"`
		DueDate     string                      `json:"due_date"`
		Recurrence  models.ClientTaskRecurrence `json:"recurrence"`
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
	assigneeIDs, err := objectIDsFromStrings(req.AssigneeIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
		return
	}
	dueDate, err := parseOptionalDate(req.DueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid due date"})
		return
	}
	userCtx, _ := currentUser(c)
	now := time.Now()
	content := normalizeClientTaskContent(req.Content)
	comment := normalizeClientTaskContent(req.Comment)
	if taskType == "annotation" {
		if comment == "" {
			comment = content
		}
		content = ""
	}
	var pinX *float64
	var pinY *float64
	if req.PinX != nil && req.PinY != nil {
		x := clampFloat(*req.PinX, 0, 100)
		y := clampFloat(*req.PinY, 0, 100)
		pinX = &x
		pinY = &y
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
		Attachments: compactStrings(req.Attachments),
		Checklist:   normalizeClientTaskChecklist(req.Checklist),
		AssigneeIDs: assigneeIDs,
		DueDate:     dueDate,
		Recurrence:  normalizeClientTaskRecurrence(req.Recurrence, dueDate),
		Status:      "todo",
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
	c.JSON(http.StatusCreated, gin.H{"task": task})
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
	members := s.clientProjectMembers(c.Request.Context(), client)
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
		Title       *string                      `json:"title"`
		Content     *string                      `json:"content"`
		URL         *string                      `json:"url"`
		Comment     *string                      `json:"comment"`
		Status      *string                      `json:"status"`
		Attachments []string                     `json:"attachments"`
		Checklist   []models.ChecklistItem       `json:"checklist"`
		AssigneeIDs []string                     `json:"assignee_ids"`
		DueDate     *string                      `json:"due_date"`
		Recurrence  *models.ClientTaskRecurrence `json:"recurrence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task update"})
		return
	}
	userCtx, _ := currentUser(c)
	hasContentChanges := req.Title != nil || req.Content != nil || req.URL != nil || req.Comment != nil || req.Attachments != nil
	if hasContentChanges && !s.canManageClientTask(c.Request.Context(), userCtx, task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the task creator or a folder admin can edit task wording"})
		return
	}
	set := bson.M{"updated_at": time.Now()}
	activityLogs := []struct {
		action string
		detail string
	}{}
	effectiveDueDate := task.DueDate
	if req.Title != nil {
		title := normalizeClientTaskTitle(*req.Title)
		if title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "task title is required"})
			return
		}
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
		if err := s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab); err == nil && status != task.Status && !containsString(normalizeClientTaskStatuses(tab.Statuses), status) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
			return
		}
		if status != task.Status {
			activityLogs = append(activityLogs, struct {
				action string
				detail string
			}{"updated_status", "changed status from " + clientTaskStatusLogLabel(task.Status) + " to " + clientTaskStatusLogLabel(status)})
		}
		set["status"] = status
	}
	if req.Attachments != nil {
		set["attachments"] = compactStrings(req.Attachments)
	}
	if req.Checklist != nil {
		set["checklist"] = normalizeClientTaskChecklist(req.Checklist)
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
		allowedAssignees := uniqueObjectIDs(append(append([]primitive.ObjectID{}, client.MemberIDs...), client.ClientAdminIDs...))
		for _, assigneeID := range assignees {
			if !containsObjectID(allowedAssignees, assigneeID) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "assignee must be listed on this client project"})
				return
			}
		}
		if !sameObjectIDSet(task.AssigneeIDs, assignees) {
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
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteClientTask(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, true)
	if !ok {
		return
	}
	comments, _ := s.clientTaskComments(c.Request.Context(), task.ID)
	for _, url := range task.Attachments {
		s.deleteLocalUploadFile(url)
	}
	for _, comment := range comments {
		s.deleteLocalUploadFile(comment.AttachmentURL)
	}
	_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
	_, _ = s.store.C("client_task_logs").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
	if _, err := s.store.C("client_tasks").DeleteOne(c.Request.Context(), bson.M{"_id": task.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete task"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
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
	s.notifyMentions(c.Request.Context(), task.TeamID, userCtx.ID, comment.Content, "client_task_comment", comment.ID)
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
	s.deleteLocalUploadFile(comment.AttachmentURL)
	s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "deleted_comment", "deleted a comment")
	c.JSON(http.StatusOK, gin.H{"deleted": true})
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
	c.JSON(http.StatusForbidden, gin.H{"error": "client folder access denied"})
	return models.ClientProject{}, false
}

func (s *Server) loadClientWebsiteForAccess(c *gin.Context, id primitive.ObjectID, manage bool) (models.ClientWebsite, bool) {
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return models.ClientWebsite{}, false
	}
	if _, ok := s.loadClientProjectForAccess(c, site.ClientID, manage); !ok {
		return models.ClientWebsite{}, false
	}
	return site, true
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
	if _, ok := s.loadClientProjectForAccess(c, tab.ClientID, manage); !ok {
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
	if _, ok := s.loadClientProjectForAccess(c, task.ClientID, false); !ok {
		return models.ClientTask{}, false
	}
	if manage {
		userCtx, _ := currentUser(c)
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
	if _, ok := s.loadClientProjectForAccess(c, task.ClientID, false); !ok {
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
	return s.canManageClientProject(ctx, userCtx, client)
}

func (s *Server) canManageClientProject(ctx context.Context, userCtx middleware.UserContext, client models.ClientProject) bool {
	return s.canManageTeamSilently(ctx, userCtx, client.TeamID) || containsObjectID(client.ClientAdminIDs, userCtx.ID)
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
		role := "member"
		if containsObjectID(client.ClientAdminIDs, user.ID) {
			role = string(models.RoleClientAdmin)
		}
		rows = append(rows, gin.H{"user": user, "client_role": role})
	}
	return rows
}

func normalizeClientTaskTitle(value string) string {
	title := strings.TrimSpace(value)
	runes := []rune(title)
	if len(runes) > 80 {
		title = string(runes[:80])
	}
	return strings.TrimSpace(title)
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
	for _, assigneeID := range task.AssigneeIDs {
		if assigneeID == task.CreatedBy {
			continue
		}
		_, _ = s.store.C("notifications").InsertOne(ctx, models.Notification{
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
