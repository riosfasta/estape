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
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": site.ClientID}).Decode(&client); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client folder not found"})
		return
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	if !s.canUseWidgetForWebsite(c.Request.Context(), userCtx, user, client, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this domain"})
		return
	}
	if _, _, membership := s.teamMembership(c.Request.Context(), site.TeamID); membership != "active" && membership != "trialing" {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "membership required", "code": "membership_required"})
		return
	}
	statuses := defaultClientTaskStatuses()
	if tab, err := s.widgetTaskBoard(c.Request.Context(), site); err == nil {
		statuses = normalizeClientTaskStatuses(tab.Statuses)
	}
	c.JSON(http.StatusOK, gin.H{
		"logged_in": true,
		"user":      user,
		"members":   s.widgetAssignableMembers(c.Request.Context(), client, site),
		"statuses":  statuses,
		"pins":      s.widgetAnnotationPins(c.Request.Context(), site, c.Query("url"), user),
	})
}

func (s *Server) createWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10<<20)
	var req struct {
		SiteKey        string   `json:"site_key"`
		URL            string   `json:"url"`
		Title          string   `json:"title"`
		Comment        string   `json:"comment"`
		ReporterName   string   `json:"reporter_name"`
		ReporterEmail  string   `json:"reporter_email"`
		AssigneeIDs    []string `json:"assignee_ids"`
		Status         string   `json:"status"`
		ScreenshotData string   `json:"screenshot_data"`
		AttachmentName string   `json:"attachment_name"`
		AttachmentData string   `json:"attachment_data"`
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
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": site.ClientID}).Decode(&client); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client folder not found"})
		return
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	if !s.canUseWidgetForWebsite(c.Request.Context(), userCtx, user, client, site) {
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
	assigneeIDs, err := objectIDsFromStrings(req.AssigneeIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
		return
	}
	allowedAssignees := s.widgetAllowedAssigneeIDs(c.Request.Context(), client, site)
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
	attachmentURL := ""
	if strings.TrimSpace(req.AttachmentData) != "" {
		url, err := s.saveWidgetAttachment(user.ID, req.AttachmentName, req.AttachmentData)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		attachmentURL = url
	}
	attachments := []string{}
	if attachmentURL != "" {
		attachments = append(attachments, attachmentURL)
	}
	tab, err := s.ensureWidgetTaskBoard(c.Request.Context(), site)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare task board"})
		return
	}
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	status := normalizeClientTaskStatus(req.Status)
	if status == "" && len(statuses) > 0 {
		status = statuses[0]
	}
	if !containsString(statuses, status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
		return
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
		Attachments:   attachments,
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
		Attachments:   attachments,
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
	c.JSON(http.StatusCreated, gin.H{"task_id": task.ID.Hex(), "annotation_id": annotation.ID.Hex(), "screenshot_url": screenshotURL, "attachment_url": attachmentURL, "status": status, "created_at": now})
}

func (s *Server) updateWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	var req struct {
		SiteKey string `json:"site_key"`
		Title   string `json:"title"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation update"})
		return
	}
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForManage(c, req.SiteKey)
	if !ok {
		return
	}
	title := normalizeClientTaskTitle(req.Title)
	comment := normalizeClientTaskContent(req.Comment)
	if title == "" {
		title = normalizeClientTaskTitle(firstNonEmpty(comment, "Website feedback"))
	}
	now := time.Now()
	set := bson.M{"updated_at": now}
	var annotation models.ClientTaskAnnotation
	if annotationIndex >= 0 {
		annotations := append([]models.ClientTaskAnnotation{}, task.Annotations...)
		annotations[annotationIndex].Title = title
		annotations[annotationIndex].Comment = comment
		annotations[annotationIndex].UpdatedAt = now
		annotation = annotations[annotationIndex]
		set["annotations"] = annotations
		if len(annotations) == 1 {
			set["title"] = title
			set["comment"] = comment
		}
		task.Annotations = annotations
	} else {
		set["title"] = title
		set["comment"] = comment
		set["updated_at"] = now
		task.Title = title
		task.Comment = comment
		annotation = models.ClientTaskAnnotation{
			ID:            task.ID,
			Title:         title,
			URL:           task.URL,
			Comment:       comment,
			ScreenshotURL: task.ScreenshotURL,
			PinX:          task.PinX,
			PinY:          task.PinY,
			PageWidth:     task.PageWidth,
			PageHeight:    task.PageHeight,
			Attachments:   task.Attachments,
			AssigneeIDs:   task.AssigneeIDs,
			Status:        task.Status,
			CreatedBy:     task.CreatedBy,
			CreatedAt:     task.CreatedAt,
			UpdatedAt:     now,
		}
	}
	if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update annotation"})
		return
	}
	if annotationIndex < 0 || len(task.Annotations) == 1 {
		task.Title = title
		task.Comment = comment
	}
	task.UpdatedAt = now
	s.recordClientTaskLog(c.Request.Context(), task, user.ID, "updated_task", "updated this annotation from the website widget")
	s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_updated")
	c.JSON(http.StatusOK, gin.H{"updated": true, "annotation": annotation})
}

func (s *Server) deleteWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	var req struct {
		SiteKey string `json:"site_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation delete"})
		return
	}
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForManage(c, req.SiteKey)
	if !ok {
		return
	}
	if annotationIndex < 0 || len(task.Annotations) <= 1 {
		comments, _ := s.clientTaskComments(c.Request.Context(), task.ID)
		relatedIDs := []primitive.ObjectID{task.ID}
		for _, comment := range comments {
			relatedIDs = append(relatedIDs, comment.ID)
		}
		if _, err := s.store.C("client_tasks").DeleteOne(c.Request.Context(), bson.M{"_id": task.ID}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete annotation"})
			return
		}
		for _, attachment := range task.Attachments {
			s.deleteLocalUploadFile(attachment)
		}
		s.deleteLocalUploadFile(task.ScreenshotURL)
		for _, comment := range comments {
			s.deleteLocalUploadFile(comment.AttachmentURL)
		}
		s.deleteNotificationsByRelatedIDs(c.Request.Context(), relatedIDs, clientTaskNotificationTypes...)
		_, _ = s.store.C("client_task_comments").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
		_, _ = s.store.C("client_task_logs").DeleteMany(c.Request.Context(), bson.M{"task_id": task.ID})
		s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_deleted")
		c.JSON(http.StatusOK, gin.H{"deleted": true})
		return
	}
	removed := task.Annotations[annotationIndex]
	annotations := append([]models.ClientTaskAnnotation{}, task.Annotations[:annotationIndex]...)
	annotations = append(annotations, task.Annotations[annotationIndex+1:]...)
	first := annotations[0]
	now := time.Now()
	set := bson.M{
		"annotations":    annotations,
		"title":          first.Title,
		"url":            first.URL,
		"comment":        first.Comment,
		"screenshot_url": first.ScreenshotURL,
		"pin_x":          first.PinX,
		"pin_y":          first.PinY,
		"page_width":     first.PageWidth,
		"page_height":    first.PageHeight,
		"attachments":    first.Attachments,
		"assignee_ids":   first.AssigneeIDs,
		"status":         first.Status,
		"updated_at":     now,
	}
	if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete annotation"})
		return
	}
	for _, attachment := range removed.Attachments {
		s.deleteLocalUploadFile(attachment)
	}
	s.deleteLocalUploadFile(removed.ScreenshotURL)
	task.Annotations = annotations
	task.Title = first.Title
	task.UpdatedAt = now
	s.recordClientTaskLog(c.Request.Context(), task, user.ID, "updated_task", "deleted an annotation from the website widget")
	s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_updated")
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func widgetAnnotationFromTask(task models.ClientTask, annotationIndex int) models.ClientTaskAnnotation {
	if annotationIndex >= 0 && annotationIndex < len(task.Annotations) {
		return task.Annotations[annotationIndex]
	}
	return models.ClientTaskAnnotation{
		ID:            task.ID,
		Title:         task.Title,
		URL:           task.URL,
		Comment:       firstNonEmpty(task.Comment, task.Content),
		ScreenshotURL: task.ScreenshotURL,
		PinX:          task.PinX,
		PinY:          task.PinY,
		PageWidth:     task.PageWidth,
		PageHeight:    task.PageHeight,
		Attachments:   task.Attachments,
		AssigneeIDs:   task.AssigneeIDs,
		Status:        task.Status,
		CreatedBy:     task.CreatedBy,
		CreatedAt:     task.CreatedAt,
		UpdatedAt:     task.UpdatedAt,
	}
}

func (s *Server) canEditWidgetAnnotation(ctx context.Context, user models.User, task models.ClientTask, annotation models.ClientTaskAnnotation) bool {
	if user.ID.IsZero() {
		return false
	}
	if annotation.CreatedBy == user.ID || task.CreatedBy == user.ID {
		return true
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	return s.canManageClientTask(ctx, userCtx, task)
}

func (s *Server) canCollaborateWidgetAnnotation(ctx context.Context, user models.User, task models.ClientTask, annotation models.ClientTaskAnnotation) bool {
	return s.canEditWidgetAnnotation(ctx, user, task, annotation) ||
		containsObjectID(annotation.AssigneeIDs, user.ID) ||
		(annotation.ID == task.ID && containsObjectID(task.AssigneeIDs, user.ID))
}

func (s *Server) widgetTaskStatuses(ctx context.Context, task models.ClientTask) []string {
	var tab models.ClientTab
	if !task.TabID.IsZero() && s.store.C("client_tabs").FindOne(ctx, bson.M{"_id": task.TabID}).Decode(&tab) == nil {
		return normalizeClientTaskStatuses(tab.Statuses)
	}
	return defaultClientTaskStatuses()
}

func (s *Server) widgetCommentRows(ctx context.Context, comments []models.ClientTaskComment) []gin.H {
	authorIDs := []primitive.ObjectID{}
	for _, comment := range comments {
		authorIDs = append(authorIDs, comment.AuthorID)
	}
	authors := map[primitive.ObjectID]models.User{}
	if ids := uniqueObjectIDs(authorIDs); len(ids) > 0 {
		cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{"name": 1, "username": 1, "email": 1, "avatar_url": 1}))
		if err == nil {
			defer cursor.Close(ctx)
			for cursor.Next(ctx) {
				var user models.User
				if cursor.Decode(&user) == nil {
					authors[user.ID] = user
				}
			}
		}
	}
	rows := make([]gin.H, 0, len(comments))
	for _, comment := range comments {
		author := authors[comment.AuthorID]
		rows = append(rows, gin.H{
			"id":              comment.ID.Hex(),
			"content":         comment.Content,
			"attachment_url":  comment.AttachmentURL,
			"attachment_name": comment.AttachmentName,
			"created_at":      comment.CreatedAt,
			"author": gin.H{
				"id":         comment.AuthorID.Hex(),
				"name":       firstNonEmpty(author.Name, author.Username, author.Email, "Team member"),
				"avatar_url": author.AvatarURL,
			},
		})
	}
	return rows
}

func (s *Server) getWidgetAnnotation(c *gin.Context) {
	s.setWidgetCORS(c)
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForAccess(c, c.Query("site_key"))
	if !ok {
		return
	}
	annotation := widgetAnnotationFromTask(task, annotationIndex)
	comments, _ := s.clientTaskComments(c.Request.Context(), task.ID)
	c.JSON(http.StatusOK, gin.H{
		"annotation": annotation,
		"task_id":    task.ID.Hex(),
		"statuses":   s.widgetTaskStatuses(c.Request.Context(), task),
		"comments":   s.widgetCommentRows(c.Request.Context(), comments),
		"can_manage": s.canCollaborateWidgetAnnotation(c.Request.Context(), user, task, annotation),
		"can_edit":   s.canEditWidgetAnnotation(c.Request.Context(), user, task, annotation),
	})
}

func (s *Server) updateWidgetAnnotationStatus(c *gin.Context) {
	s.setWidgetCORS(c)
	var req struct {
		SiteKey string `json:"site_key"`
		Status  string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation status update"})
		return
	}
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForAccess(c, req.SiteKey)
	if !ok {
		return
	}
	annotation := widgetAnnotationFromTask(task, annotationIndex)
	if !s.canCollaborateWidgetAnnotation(c.Request.Context(), user, task, annotation) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an assignee, creator, or folder admin can update this annotation"})
		return
	}
	status := normalizeClientTaskStatus(req.Status)
	statuses := s.widgetTaskStatuses(c.Request.Context(), task)
	if status == "" || !containsString(statuses, status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is not in this task board"})
		return
	}
	oldStatus := annotation.Status
	now := time.Now()
	set := bson.M{"updated_at": now}
	if annotationIndex >= 0 {
		annotations := append([]models.ClientTaskAnnotation{}, task.Annotations...)
		annotations[annotationIndex].Status = status
		annotations[annotationIndex].UpdatedAt = now
		annotation = annotations[annotationIndex]
		set["annotations"] = annotations
		if len(annotations) == 1 {
			set["status"] = status
		}
	} else {
		annotation.Status = status
		annotation.UpdatedAt = now
		set["status"] = status
	}
	if _, err := s.store.C("client_tasks").UpdateByID(c.Request.Context(), task.ID, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update annotation status"})
		return
	}
	task.UpdatedAt = now
	s.recordClientTaskLog(c.Request.Context(), task, user.ID, "updated_status", "changed annotation status from "+clientTaskStatusLogLabel(oldStatus)+" to "+clientTaskStatusLogLabel(status)+" from the website widget")
	actor := s.notificationActorName(c.Request.Context(), user.ID)
	s.notifyUserIDs(c.Request.Context(), s.clientTaskNotificationRecipients(c.Request.Context(), task), user.ID, "client_task_updated", actor+" set annotation status as "+clientTaskStatusLogLabel(status)+" in task: "+task.Title, task.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_updated")
	c.JSON(http.StatusOK, gin.H{"status": status, "annotation": annotation})
}

func (s *Server) createWidgetAnnotationComment(c *gin.Context) {
	s.setWidgetCORS(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
	var req struct {
		SiteKey        string `json:"site_key"`
		Content        string `json:"content"`
		AttachmentName string `json:"attachment_name"`
		AttachmentData string `json:"attachment_data"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation comment"})
		return
	}
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForAccess(c, req.SiteKey)
	if !ok {
		return
	}
	annotation := widgetAnnotationFromTask(task, annotationIndex)
	if !s.canCollaborateWidgetAnnotation(c.Request.Context(), user, task, annotation) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an assignee, creator, or folder admin can comment on this annotation"})
		return
	}
	content := strings.TrimSpace(req.Content)
	attachmentURL := ""
	if strings.TrimSpace(req.AttachmentData) != "" {
		url, err := s.saveWidgetAttachment(user.ID, req.AttachmentName, req.AttachmentData)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		attachmentURL = url
	}
	if content == "" && attachmentURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comment or attachment is required"})
		return
	}
	comment := models.ClientTaskComment{
		ID:             primitive.NewObjectID(),
		TaskID:         task.ID,
		ClientID:       task.ClientID,
		WebsiteID:      task.WebsiteID,
		TabID:          task.TabID,
		TeamID:         task.TeamID,
		AuthorID:       user.ID,
		Content:        content,
		AttachmentURL:  attachmentURL,
		AttachmentName: strings.TrimSpace(req.AttachmentName),
		ReadBy:         []primitive.ObjectID{user.ID},
		CreatedAt:      time.Now(),
	}
	if _, err := s.store.C("client_task_comments").InsertOne(c.Request.Context(), comment); err != nil {
		if attachmentURL != "" {
			s.deleteLocalUploadFile(attachmentURL)
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create comment"})
		return
	}
	detail := "created a comment from the website widget"
	if attachmentURL != "" {
		detail = "created a comment with attachment from the website widget"
	}
	s.recordClientTaskLog(c.Request.Context(), task, user.ID, "created_comment", detail)
	mentionedIDs := s.notifyClientTaskCommentMentions(c.Request.Context(), task, user.ID, comment.Content, comment.ID)
	actor := s.notificationActorName(c.Request.Context(), user.ID)
	recipients := withoutObjectIDs(s.clientTaskNotificationRecipients(c.Request.Context(), task), mentionedIDs)
	s.notifyUserIDs(c.Request.Context(), recipients, user.ID, "client_task_comment", actor+" sent a comment in task: "+task.Title, comment.ID)
	s.broadcastClientTaskChanged(c.Request.Context(), task, user.ID, "client_task_comment")
	c.JSON(http.StatusCreated, gin.H{"comment": s.widgetCommentRows(c.Request.Context(), []models.ClientTaskComment{comment})[0]})
}

func (s *Server) loadWidgetAnnotationForAccess(c *gin.Context, siteKey string) (models.User, models.ClientTask, int, bool) {
	user, ok := s.widgetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "sign in to BugMega before viewing website feedback"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	site, ok := s.loadWidgetWebsiteByKey(c, siteKey)
	if !ok {
		return models.User{}, models.ClientTask{}, -1, false
	}
	if !widgetOriginAllowed(site.URL, c.GetHeader("Origin")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "this website is not allowed to access feedback for this domain"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	var client models.ClientProject
	if err := s.store.C("client_projects").FindOne(c.Request.Context(), bson.M{"_id": site.ClientID}).Decode(&client); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client folder not found"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	userCtx := middleware.UserContext{ID: user.ID, Role: user.Role, TeamID: user.TeamID}
	if !s.canUseWidgetForWebsite(c.Request.Context(), userCtx, user, client, site) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this domain"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	if _, _, membership := s.teamMembership(c.Request.Context(), site.TeamID); membership != "active" && membership != "trialing" {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "membership required", "code": "membership_required"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	annotationID, err := objectIDFromString(c.Param("annotation_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid annotation id"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	filter := bson.M{"website_id": site.ID, "type": "annotation", "$or": []bson.M{{"annotations.id": annotationID}, {"_id": annotationID}}}
	var task models.ClientTask
	if err := s.store.C("client_tasks").FindOne(c.Request.Context(), filter).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "annotation not found"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	annotationIndex := -1
	for index := range task.Annotations {
		if task.Annotations[index].ID == annotationID {
			annotationIndex = index
			break
		}
	}
	if annotationIndex < 0 && task.ID != annotationID {
		c.JSON(http.StatusNotFound, gin.H{"error": "annotation not found"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	return user, task, annotationIndex, true
}

func (s *Server) loadWidgetAnnotationForManage(c *gin.Context, siteKey string) (models.User, models.ClientTask, int, bool) {
	user, task, annotationIndex, ok := s.loadWidgetAnnotationForAccess(c, siteKey)
	if !ok {
		return models.User{}, models.ClientTask{}, -1, false
	}
	annotation := widgetAnnotationFromTask(task, annotationIndex)
	if !s.canEditWidgetAnnotation(c.Request.Context(), user, task, annotation) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the annotation creator or a folder admin can manage this annotation"})
		return models.User{}, models.ClientTask{}, -1, false
	}
	return user, task, annotationIndex, true
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
	c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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
		tokenHash := auth.HashToken(strings.TrimSpace(cookie))
		filter := bson.M{
			"$or": []bson.M{
				{"refresh_token_hash": tokenHash},
				{"refresh_token_hashes": tokenHash},
			},
		}
		var user models.User
		err := s.store.C("users").FindOne(c.Request.Context(), filter).Decode(&user)
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

func (s *Server) canUseWidgetForWebsite(ctx context.Context, userCtx middleware.UserContext, user models.User, client models.ClientProject, site models.ClientWebsite) bool {
	if user.ID.IsZero() || user.Status != models.StatusActive {
		return false
	}
	if s.canManageClientProject(ctx, userCtx, client) ||
		containsObjectID(client.MemberIDs, user.ID) ||
		containsObjectID(client.ClientAdminIDs, user.ID) ||
		containsObjectID(site.MemberIDs, user.ID) ||
		containsObjectID(site.ClientAdminIDs, user.ID) ||
		site.CreatedBy == user.ID ||
		client.CreatedBy == user.ID {
		return true
	}
	return s.isActiveWidgetTeamMember(ctx, site.TeamID, user)
}

func (s *Server) isActiveWidgetTeamMember(ctx context.Context, teamID primitive.ObjectID, user models.User) bool {
	if teamID.IsZero() || user.ID.IsZero() || user.Status != models.StatusActive {
		return false
	}
	if user.TeamID == teamID {
		return true
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": teamID}).Decode(&team); err != nil {
		return false
	}
	return team.OwnerAdminID == user.ID || containsObjectID(team.MemberIDs, user.ID)
}

func (s *Server) widgetAllowedAssigneeIDs(ctx context.Context, client models.ClientProject, site models.ClientWebsite) []primitive.ObjectID {
	ids := allowedClientTaskAssignees(client, site)
	ids = append(ids, s.widgetTeamMemberIDs(ctx, site.TeamID)...)
	return uniqueObjectIDs(ids)
}

func (s *Server) widgetTeamMemberIDs(ctx context.Context, teamID primitive.ObjectID) []primitive.ObjectID {
	if teamID.IsZero() {
		return []primitive.ObjectID{}
	}
	ids := []primitive.ObjectID{}
	var team models.Team
	if err := s.store.C("teams").FindOne(ctx, bson.M{"_id": teamID}).Decode(&team); err == nil {
		ids = append(ids, team.OwnerAdminID)
		ids = append(ids, team.MemberIDs...)
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"team_id": teamID, "status": models.StatusActive}, options.Find().SetProjection(bson.M{"_id": 1}))
	if err == nil {
		defer cursor.Close(ctx)
		for cursor.Next(ctx) {
			var user models.User
			if cursor.Decode(&user) == nil {
				ids = append(ids, user.ID)
			}
		}
	}
	return uniqueObjectIDs(ids)
}

func (s *Server) widgetAssignableMembers(ctx context.Context, client models.ClientProject, site models.ClientWebsite) []gin.H {
	allowedIDs := s.widgetAllowedAssigneeIDs(ctx, client, site)
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

func (s *Server) widgetAnnotationPins(ctx context.Context, site models.ClientWebsite, pageURL string, user models.User) []gin.H {
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
					"id":             annotation.ID.Hex(),
					"task_id":        task.ID.Hex(),
					"title":          annotation.Title,
					"comment":        annotation.Comment,
					"status":         annotation.Status,
					"screenshot_url": annotation.ScreenshotURL,
					"attachments":    annotation.Attachments,
					"pin_x":          *annotation.PinX,
					"pin_y":          *annotation.PinY,
					"page_width":     annotation.PageWidth,
					"page_height":    annotation.PageHeight,
					"created_at":     annotation.CreatedAt,
					"can_manage":     s.canCollaborateWidgetAnnotation(ctx, user, task, annotation),
					"can_edit":       s.canEditWidgetAnnotation(ctx, user, task, annotation),
				})
			}
			continue
		}
		if normalizeWidgetPageURL(task.URL) != pageURL || task.PinX == nil || task.PinY == nil {
			continue
		}
		rows = append(rows, gin.H{
			"id":             task.ID.Hex(),
			"task_id":        task.ID.Hex(),
			"title":          task.Title,
			"comment":        firstNonEmpty(task.Comment, task.Content),
			"status":         task.Status,
			"screenshot_url": task.ScreenshotURL,
			"attachments":    task.Attachments,
			"pin_x":          *task.PinX,
			"pin_y":          *task.PinY,
			"page_width":     task.PageWidth,
			"page_height":    task.PageHeight,
			"created_at":     task.CreatedAt,
			"can_manage":     s.canCollaborateWidgetAnnotation(ctx, user, task, widgetAnnotationFromTask(task, -1)),
			"can_edit":       s.canEditWidgetAnnotation(ctx, user, task, widgetAnnotationFromTask(task, -1)),
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

func (s *Server) saveWidgetAttachment(ownerID primitive.ObjectID, filename string, dataURL string) (string, error) {
	if ownerID.IsZero() {
		return "", errors.New("website owner is missing")
	}
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".pdf": true, ".txt": true, ".csv": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".zip": true}
	if !allowed[ext] {
		return "", errors.New("unsupported attachment type")
	}
	raw := strings.TrimSpace(dataURL)
	separator := strings.Index(raw, ",")
	if !strings.HasPrefix(raw, "data:") || separator < 0 || !strings.HasSuffix(strings.ToLower(raw[:separator]), ";base64") {
		return "", errors.New("attachment must be a base64 data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw[separator+1:]))
	if err != nil {
		return "", errors.New("attachment could not be decoded")
	}
	if len(decoded) == 0 {
		return "", errors.New("attachment is empty")
	}
	if len(decoded) > 1<<20 {
		return "", errors.New("attachment must be 1 MB or smaller")
	}
	name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	relativeDir := filepath.Join(userUploadDir(ownerID), "widget")
	path := filepath.Join(s.cfg.UploadDir, relativeDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", errors.New("could not prepare upload directory")
	}
	if err := os.WriteFile(path, decoded, 0644); err != nil {
		return "", errors.New("could not save attachment")
	}
	return "/uploads/" + filepath.ToSlash(filepath.Join(relativeDir, name)), nil
}

func (s *Server) ensureWidgetTaskBoard(ctx context.Context, site models.ClientWebsite) (models.ClientTab, error) {
	tab, err := s.widgetTaskBoard(ctx, site)
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

func (s *Server) widgetTaskBoard(ctx context.Context, site models.ClientWebsite) (models.ClientTab, error) {
	var tab models.ClientTab
	err := s.store.C("client_tabs").FindOne(
		ctx,
		bson.M{"website_id": site.ID, "type": "task_board"},
		options.FindOne().SetSort(bson.D{{Key: "created_at", Value: 1}}),
	).Decode(&tab)
	return tab, err
}
