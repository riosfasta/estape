package handlers

import (
	"net/http"
	"strings"
	"time"

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
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		filter["role"] = role
	}
	cursor, err := s.store.C("users").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(250))
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
	c.JSON(http.StatusOK, gin.H{"users": users})
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
	c.JSON(http.StatusOK, gin.H{"updated": true})
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
		count, err := s.store.C("users").CountDocuments(c.Request.Context(), bson.M{"role": models.RoleOwnerAdmin, "status": models.StatusActive, "_id": bson.M{"$ne": id}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not validate owner accounts"})
			return
		}
		if count == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the last active owner admin"})
			return
		}
	}
	if !target.TeamID.IsZero() {
		_, _ = s.store.C("teams").UpdateMany(c.Request.Context(), bson.M{"member_ids": id}, bson.M{"$pull": bson.M{"member_ids": id}})
		_, _ = s.store.C("teams").UpdateMany(c.Request.Context(), bson.M{"owner_admin_id": id}, bson.M{"$unset": bson.M{"owner_admin_id": ""}})
	}
	if _, err := s.store.C("users").DeleteOne(c.Request.Context(), bson.M{"_id": id}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove user"})
		return
	}
	s.audit(c.Request.Context(), userCtx.ID, "user.removed", "user", id)
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

func (s *Server) getSettings(c *gin.Context) {
	var settings models.SiteSettings
	if err := s.store.C("site_settings").FindOne(c.Request.Context(), bson.M{}).Decode(&settings); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "settings not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": settings})
}

func (s *Server) updateSettings(c *gin.Context) {
	var req models.SiteSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settings body"})
		return
	}
	set := bson.M{
		"site_name":       strings.TrimSpace(req.SiteName),
		"company_email":   strings.TrimSpace(req.CompanyEmail),
		"owner_name":      strings.TrimSpace(req.OwnerName),
		"company_address": strings.TrimSpace(req.CompanyAddress),
		"logo_url":        strings.TrimSpace(req.LogoURL),
		"support_phone":   strings.TrimSpace(req.SupportPhone),
		"updated_at":      time.Now(),
	}
	_, err := s.store.C("site_settings").UpdateOne(c.Request.Context(), bson.M{}, bson.M{"$set": set}, options.Update().SetUpsert(true))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) adminPages(c *gin.Context) {
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
	c.JSON(http.StatusOK, gin.H{"pages": pages})
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
	page := models.StaticPage{
		ID:        primitive.NewObjectID(),
		Slug:      req.Slug,
		Title:     strings.TrimSpace(req.Title),
		Status:    "draft",
		Blocks:    []models.PageBlock{{ID: primitive.NewObjectID().Hex(), Type: "heading", Props: map[string]interface{}{"text": req.Title, "level": "h1"}}},
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
		Title  string             `json:"title"`
		Blocks []models.PageBlock `json:"blocks"`
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
	var settings models.SiteSettings
	_ = s.store.C("site_settings").FindOne(c.Request.Context(), bson.M{}).Decode(&settings)
	html := pagebuilder.Render(page.Blocks, pagebuilder.RenderContext{Settings: settings})
	version := models.PageVersion{ID: primitive.NewObjectID(), Blocks: page.Blocks, HTML: html, CreatedAt: time.Now(), CreatedBy: userCtx.ID}
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
			_, err := s.store.C("static_pages").UpdateByID(c.Request.Context(), page.ID, bson.M{"$set": bson.M{"blocks": version.Blocks, "rendered_html_cache": version.HTML, "status": "draft", "updated_by": userCtx.ID, "updated_at": time.Now()}})
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
	c.JSON(http.StatusOK, gin.H{"title": page.Title, "html": page.RenderedHTMLCache})
}

func (s *Server) publicLegalPage(c *gin.Context) {
	var page models.StaticPage
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": c.Param("slug"), "status": "published"}).Decode(&page); err != nil {
		c.HTML(http.StatusNotFound, "legal.gohtml", gin.H{"Title": "Page not found", "HTML": "<p>Page not found.</p>", "AppName": s.cfg.AppName})
		return
	}
	c.HTML(http.StatusOK, "legal.gohtml", gin.H{"Title": page.Title, "HTML": page.RenderedHTMLCache, "AppName": s.cfg.AppName, "Year": time.Now().Year()})
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '-'
	})
	return strings.Trim(strings.Join(fields, "-"), "-")
}
