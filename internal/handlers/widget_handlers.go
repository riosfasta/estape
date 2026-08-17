package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) widgetScript(c *gin.Context) {
	c.Header("Content-Type", "application/javascript; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=300")
	c.Header("Access-Control-Allow-Origin", "*")
	c.File("web/static/js/widget.js")
}

func (s *Server) widgetOptions(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) widgetSession(c *gin.Context) {
	s.setWidgetCORS(c)
	user, ok := s.widgetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"logged_in": false})
		return
	}
	site, ok := s.widgetWebsiteForRequest(c)
	if !ok {
		return
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	if !s.canAccessClientWebsite(c.Request.Context(), userCtx, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this domain"})
		return
	}
	if _, _, membership := s.teamMembership(c.Request.Context(), site.TeamID); membership != "active" && membership != "trialing" {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "membership required", "code": "membership_required"})
		return
	}
	var client models.ClientProject
	_ = s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": site.ClientID}).Decode(&client)
	c.JSON(http.StatusOK, gin.H{
		"logged_in": true,
		"user":      user,
		"members":   s.widgetAssignableMembers(c.Request.Context(), client, site),
		"pins":      s.widgetAnnotationPins(c.Request.Context(), site, c.Query("url")),
	})
}

func (s *Server) createWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
	var req struct {
		SiteKey        string   `json:"site_key"`
		URL            string   `json:"url"`
		Title          string   `json:"title"`
		Comment        string   `json:"comment"`
		ReporterName   string   `json:"reporter_name"`
		ReporterEmail  string   `json:"reporter_email"`
		AssigneeIDs    []string `json:"assignee_ids"`
		ScreenshotData string   `json:"screenshot_data"`
		CaptureError   string   `json:"capture_error"`
		PinX           *float64 `json:"pin_x"`
		PinY           *float64 `json:"pin_y"`
		PageWidth      int      `json:"page_width"`
		PageHeight     int      `json:"page_height"`
		ViewportWidth  int      `json:"viewport_width"`
		ViewportHeight int      `json:"viewport_height"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feedback body"})
		return
	}
	user, ok := s.widgetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "sign in to BugMega before using website feedback"})
		return
	}
	site, ok := s.loadWidgetWebsiteByKey(c, req.SiteKey)
	if !ok {
		return
	}
	if !widgetOriginAllowed(site.URL, c.GetHeader("Origin")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "this website is not allowed to submit feedback for this domain"})
		return
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	if !s.canAccessClientWebsite(c.Request.Context(), userCtx, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this domain"})
		return
	}
	if _, _, membership := s.teamMembership(c.Request.Context(), site.TeamID); membership != "active" && membership != "trialing" {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "membership required", "code": "membership_required"})
		return
	}
	pageURL := strings.TrimSpace(req.URL)
	if pageURL == "" {
		pageURL = strings.TrimSpace(site.URL)
	}
	if !strings.HasPrefix(strings.ToLower(pageURL), "https://") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "annotation URL must start with https://"})
		return
	}
	if req.PinX == nil || req.PinY == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pin position is required"})
		return
	}
	var client models.ClientProject
	_ = s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": site.ClientID}).Decode(&client)
	assigneeIDs, err := objectIDsFromStrings(req.AssigneeIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
		return
	}
	allowedAssignees := allowedClientTaskAssignees(client, site)
	for _, assigneeID := range assigneeIDs {
		if !containsObjectID(allowedAssignees, assigneeID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "assignee must have access to this domain"})
			return
		}
	}
	title := normalizeClientTaskTitle(req.Title)
	comment := normalizeClientTaskContent(req.Comment)
	reporter := widgetReporterLine(req.ReporterName, req.ReporterEmail)
	if reporter != "" {
		if comment != "" {
			comment += "\n\n"
		}
		comment += reporter
	}
	if strings.TrimSpace(req.CaptureError) != "" && strings.TrimSpace(req.ScreenshotData) == "" {
		if comment != "" {
			comment += "\n\n"
		}
		comment += "Capture note: " + normalizeClientTaskContent(req.CaptureError)
	}
	if title == "" {
		title = normalizeClientTaskTitle(firstNonEmpty(req.Comment, "Website feedback"))
	}
	if comment == "" {
		comment = "Submitted from the website feedback widget."
	}
	screenshotURL := ""
	if strings.TrimSpace(req.ScreenshotData) != "" {
		url, err := s.saveWidgetScreenshot(user.ID, req.ScreenshotData)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		screenshotURL = url
	}
	tab, err := s.ensureWidgetTaskBoard(c.Request.Context(), site)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare task board"})
		return
	}
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	status := "todo"
	if len(statuses) > 0 {
		status = statuses[0]
	}
	x := clampFloat(*req.PinX, 0, 100)
	y := clampFloat(*req.PinY, 0, 100)
	pageWidth := normalizeAnnotationPageDimension(req.PageWidth, 320, 8000)
	if pageWidth == 0 {
		pageWidth = normalizeAnnotationPageDimension(req.ViewportWidth, 320, 8000)
	}
	pageHeight := normalizeAnnotationPageDimension(req.PageHeight, 900, 50000)
	if pageHeight == 0 {
		pageHeight = normalizeAnnotationPageDimension(req.ViewportHeight, 900, 50000)
	}
	now := time.Now()
	annotation := models.ClientTaskAnnotation{
		ID:            primitive.NewObjectID(),
		Title:         title,
		URL:           pageURL,
		Comment:       comment,
		ScreenshotURL: screenshotURL,
		PinX:          &x,
		PinY:          &y,
		PageWidth:     pageWidth,
		PageHeight:    pageHeight,
		Attachments:   []string{},
		AssigneeIDs:   assigneeIDs,
		Status:        status,
		CreatedBy:     user.ID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	task := models.ClientTask{
		ID:            primitive.NewObjectID(),
		ClientID:      site.ClientID,
		WebsiteID:     site.ID,
		TabID:         tab.ID,
		TeamID:        site.TeamID,
		Type:          "annotation",
		Title:         title,
		Content:       "",
		URL:           pageURL,
		Comment:       comment,
		ScreenshotURL: screenshotURL,
		PinX:          &x,
		PinY:          &y,
		PageWidth:     pageWidth,
		PageHeight:    pageHeight,
		Annotations:   []models.ClientTaskAnnotation{annotation},
		Attachments:   []string{},
		Checklist:     []models.ChecklistItem{},
		Blocks:        []models.ClientTaskBlock{},
		AssigneeIDs:   assigneeIDs,
		Status:        status,
		CreatedBy:     user.ID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if _, err := s.store.C("client_tasks").InsertOne(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create feedback task"})
		return
	}
	s.recordClientTaskLog(c.Request.Context(), task, user.ID, "created_task", "created this annotation from the website widget")
	s.notifyClientTaskAssignees(c.Request.Context(), task)
	s.notifyUserIDs(c.Request.Context(), s.clientWebsiteLiveRecipients(c.Request.Context(), site), user.ID, "client_task_updated", firstNonEmpty(user.Name, user.Username, user.Email, "Someone")+" submitted website feedback: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_created")
	c.JSON(http.StatusCreated, gin.H{"task_id": task.ID.Hex(), "annotation_id": annotation.ID.Hex(), "screenshot_url": screenshotURL})
}

func (s *Server) setWidgetCORS(c *gin.Context) {
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if origin == "" {
		c.Header("Access-Control-Allow-Origin", "*")
	} else {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
		c.Header("Access-Control-Allow-Credentials", "true")
	}
	c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Content-Type")
	c.Header("Access-Control-Max-Age", "600")
}

func (s *Server) widgetWebsiteForRequest(c *gin.Context) (models.ClientWebsite, bool) {
	return s.loadWidgetWebsiteByKey(c, c.Query("site_key"))
}

func (s *Server) loadWidgetWebsiteByKey(c *gin.Context, value string) (models.ClientWebsite, bool) {
	siteKey := strings.TrimSpace(value)
	if siteKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "widget key is required"})
		return models.ClientWebsite{}, false
	}
	var site models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"widget_key": siteKey}).Decode(&site); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website widget was not found"})
		return models.ClientWebsite{}, false
	}
	if !widgetOriginAllowed(site.URL, c.GetHeader("Origin")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "this website is not allowed to use this widget"})
		return models.ClientWebsite{}, false
	}
	return site, true
}

func (s *Server) widgetAuthenticatedUser(c *gin.Context) (models.User, bool) {
	if cookie, err := c.Cookie("access_token"); err == nil && strings.TrimSpace(cookie) != "" {
		if claims, err := s.tokens.ParseAccessToken(strings.TrimSpace(cookie)); err == nil {
			if userID, err := primitive.ObjectIDFromHex(claims.Subject); err == nil {
				if user, err := s.loadUser(c.Request.Context(), userID); err == nil && user.Status == models.StatusActive {
					return user, true
				}
			}
		}
	}
	if cookie, err := c.Cookie("refresh_token"); err == nil && strings.TrimSpace(cookie) != "" {
		var user models.User
		err := s.store.C("users").FindOne(c.Request.Context(), bson.M{"refresh_token_hash": auth.HashToken(strings.TrimSpace(cookie))}).Decode(&user)
		if err == nil && user.Status == models.StatusActive {
			access, refresh, err := s.issueTokens(c.Request.Context(), user)
			if err == nil {
				s.setSessionCookies(c, access, refresh)
				return user, true
			}
		}
	}
	return models.User{}, false
}

func (s *Server) widgetAssignableMembers(ctx context.Context, client models.ClientProject, site models.ClientWebsite) []gin.H {
	allowedIDs := allowedClientTaskAssignees(client, site)
	if len(allowedIDs) == 0 {
		return []gin.H{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": allowedIDs}, "status": models.StatusActive}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
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
		rows = append(rows, gin.H{
			"id":         user.ID.Hex(),
			"name":       user.Name,
			"username":   user.Username,
			"email":      user.Email,
			"avatar_url": user.AvatarURL,
			"staff_role": user.StaffRole,
		})
	}
	return rows
}

func (s *Server) widgetAnnotationPins(ctx context.Context, site models.ClientWebsite, pageURL string) []gin.H {
	pageURL = normalizeWidgetPageURL(pageURL)
	if pageURL == "" {
		return []gin.H{}
	}
	filter := bson.M{
		"website_id": site.ID,
		"type":       "annotation",
	}
	cursor, err := s.store.C("client_tasks").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}).SetLimit(200))
	if err != nil {
		return []gin.H{}
	}
	defer cursor.Close(ctx)
	rows := []gin.H{}
	for cursor.Next(ctx) {
		var task models.ClientTask
		if cursor.Decode(&task) != nil {
			continue
		}
		if len(task.Annotations) > 0 {
			for _, annotation := range task.Annotations {
				if normalizeWidgetPageURL(annotation.URL) != pageURL || annotation.PinX == nil || annotation.PinY == nil {
					continue
				}
				rows = append(rows, gin.H{
					"id":          annotation.ID.Hex(),
					"task_id":     task.ID.Hex(),
					"title":       annotation.Title,
					"pin_x":       *annotation.PinX,
					"pin_y":       *annotation.PinY,
					"page_width":  annotation.PageWidth,
					"page_height": annotation.PageHeight,
					"created_at":  annotation.CreatedAt,
				})
			}
			continue
		}
		if normalizeWidgetPageURL(task.URL) != pageURL || task.PinX == nil || task.PinY == nil {
			continue
		}
		rows = append(rows, gin.H{
			"id":          task.ID.Hex(),
			"task_id":     task.ID.Hex(),
			"title":       task.Title,
			"pin_x":       *task.PinX,
			"pin_y":       *task.PinY,
			"page_width":  task.PageWidth,
			"page_height": task.PageHeight,
			"created_at":  task.CreatedAt,
		})
	}
	return rows
}

func normalizeWidgetPageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return ""
	}
	parsed.Fragment = ""
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	return strings.TrimRight(parsed.String(), "/")
}

func (s *Server) newClientWebsiteWidgetKey(ctx context.Context) (string, error) {
	for i := 0; i < 6; i++ {
		key, err := randomWidgetKey()
		if err != nil {
			return "", err
		}
		count, err := s.store.C("client_websites").CountDocuments(ctx, bson.M{"widget_key": key})
		if err != nil {
			return "", err
		}
		if count == 0 {
			return key, nil
		}
	}
	return "", errors.New("could not create unique widget key")
}

func (s *Server) ensureClientWebsiteWidgetKey(ctx context.Context, site *models.ClientWebsite) (string, error) {
	if site == nil {
		return "", errors.New("website is required")
	}
	if strings.TrimSpace(site.WidgetKey) != "" {
		return site.WidgetKey, nil
	}
	key, err := s.newClientWebsiteWidgetKey(ctx)
	if err != nil {
		return "", err
	}
	_, err = s.store.C("client_websites").UpdateByID(ctx, site.ID, bson.M{"$set": bson.M{"widget_key": key, "updated_at": time.Now()}})
	if err != nil {
		return "", err
	}
	site.WidgetKey = key
	return key, nil
}

func randomWidgetKey() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func widgetOriginAllowed(siteURL string, origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	siteURL = normalizeOptionalURL(siteURL)
	parsedSite, err := url.Parse(siteURL)
	if err != nil || strings.TrimSpace(parsedSite.Host) == "" {
		return false
	}
	return normalizedWidgetHost(originURL.Host) == normalizedWidgetHost(parsedSite.Host)
}

func normalizedWidgetHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimPrefix(host, "www.")
	return host
}

func widgetReporterLine(name string, email string) string {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	parts := []string{}
	if name != "" {
		parts = append(parts, "Name: "+name)
	}
	if email != "" {
		parts = append(parts, "Email: "+email)
	}
	if len(parts) == 0 {
		return ""
	}
	return "Reporter - " + strings.Join(parts, ", ")
}

func (s *Server) saveWidgetScreenshot(ownerID primitive.ObjectID, dataURL string) (string, error) {
	if ownerID.IsZero() {
		return "", errors.New("website owner is missing")
	}
	raw := strings.TrimSpace(dataURL)
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) {
		return "", errors.New("screenshot must be a PNG data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(strings.TrimPrefix(raw, prefix)))
	if err != nil {
		return "", errors.New("screenshot could not be decoded")
	}
	if len(decoded) == 0 {
		return "", errors.New("screenshot is empty")
	}
	if len(decoded) > 6<<20 {
		return "", errors.New("screenshot is too large")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return "", errors.New("screenshot is not a valid image")
	}
	name := fmt.Sprintf("%d.png", time.Now().UnixNano())
	relativeDir := filepath.Join(userUploadDir(ownerID), "widget")
	path := filepath.Join(s.cfg.UploadDir, relativeDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", errors.New("could not prepare upload directory")
	}
	if err := os.WriteFile(path, decoded, 0644); err != nil {
		return "", errors.New("could not save screenshot")
	}
	return "/uploads/" + filepath.ToSlash(filepath.Join(relativeDir, name)), nil
}

func (s *Server) ensureWidgetTaskBoard(ctx context.Context, site models.ClientWebsite) (models.ClientTab, error) {
	var tab models.ClientTab
	err := s.store.C("client_tabs").FindOne(
		ctx,
		bson.M{"website_id": site.ID, "type": "task_board"},
		options.FindOne().SetSort(bson.D{{Key: "created_at", Value: 1}}),
	).Decode(&tab)
	if err == nil {
		return tab, nil
	}
	if err != mongo.ErrNoDocuments {
		return models.ClientTab{}, err
	}
	now := time.Now()
	tab = defaultClientTaskBoardTab(site, site.CreatedBy, now)
	if _, err := s.store.C("client_tabs").InsertOne(ctx, tab); err != nil {
		return models.ClientTab{}, err
	}
	s.broadcastClientTabChanged(ctx, tab, site.CreatedBy, "client_tab_created")
	return tab, nil
}
