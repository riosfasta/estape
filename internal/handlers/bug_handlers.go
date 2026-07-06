package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) listWebsites(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := bson.M{}
	if userCtx.Role != models.RoleOwnerAdmin {
		filter["team_id"] = userCtx.TeamID
	}
	cursor, err := s.store.C("websites").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load websites"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var websites []models.Website
	if err := cursor.All(c.Request.Context(), &websites); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode websites"})
		return
	}
	if websites == nil {
		websites = []models.Website{}
	}
	c.JSON(http.StatusOK, gin.H{"websites": websites})
}

func (s *Server) getWebsite(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var website models.Website
	if err := s.store.C("websites").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&website); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return
	}
	if !s.canAccessTeam(c, website.TeamID) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"website": website})
}

func (s *Server) createWebsite(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Name          string `json:"name"`
		URL           string `json:"url"`
		EmbedMode     string `json:"embed_mode"`
		ScreenshotURL string `json:"screenshot_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid website body"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.URL = strings.TrimSpace(req.URL)
	if req.Name == "" || req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and url are required"})
		return
	}
	if req.EmbedMode != "screenshot" {
		req.EmbedMode = "iframe"
	}
	website := models.Website{
		ID:            primitive.NewObjectID(),
		TeamID:        userCtx.TeamID,
		Name:          req.Name,
		URL:           req.URL,
		EmbedMode:     req.EmbedMode,
		ScreenshotURL: strings.TrimSpace(req.ScreenshotURL),
		CreatedBy:     userCtx.ID,
		CreatedAt:     time.Now(),
	}
	if _, err := s.store.C("websites").InsertOne(c.Request.Context(), website); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create website"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"website": website})
}

func (s *Server) listBugs(c *gin.Context) {
	websiteID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var website models.Website
	if err := s.store.C("websites").FindOne(c.Request.Context(), bson.M{"_id": websiteID}).Decode(&website); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return
	}
	if !s.canAccessTeam(c, website.TeamID) {
		return
	}
	filter := bson.M{"website_id": websiteID}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		filter["status"] = status
	}
	cursor, err := s.store.C("bugs").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load bugs"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var bugs []models.Bug
	if err := cursor.All(c.Request.Context(), &bugs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode bugs"})
		return
	}
	if bugs == nil {
		bugs = []models.Bug{}
	}
	c.JSON(http.StatusOK, gin.H{"bugs": bugs})
}

func (s *Server) createBug(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		WebsiteID     string  `json:"website_id"`
		PinX          float64 `json:"pin_x"`
		PinY          float64 `json:"pin_y"`
		PageURL       string  `json:"page_url"`
		ScreenshotURL string  `json:"screenshot_url"`
		Description   string  `json:"description"`
		Severity      string  `json:"severity"`
		AssigneeID    string  `json:"assignee_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bug body"})
		return
	}
	websiteID, err := objectIDFromString(req.WebsiteID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid website_id"})
		return
	}
	var website models.Website
	if err := s.store.C("websites").FindOne(c.Request.Context(), bson.M{"_id": websiteID}).Decode(&website); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "website not found"})
		return
	}
	if !s.canAccessTeam(c, website.TeamID) {
		return
	}
	var assigneeID primitive.ObjectID
	if strings.TrimSpace(req.AssigneeID) != "" {
		assigneeID, err = objectIDFromString(req.AssigneeID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee_id"})
			return
		}
	}
	if req.Severity == "" {
		req.Severity = "Normal"
	}
	bug := models.Bug{
		ID:            primitive.NewObjectID(),
		WebsiteID:     websiteID,
		PinX:          clampFloat(req.PinX, 0, 100),
		PinY:          clampFloat(req.PinY, 0, 100),
		PageURL:       strings.TrimSpace(req.PageURL),
		ScreenshotURL: strings.TrimSpace(req.ScreenshotURL),
		Description:   strings.TrimSpace(req.Description),
		Severity:      req.Severity,
		Status:        "Open",
		AssigneeID:    assigneeID,
		Comments:      []models.Comment{},
		CreatedBy:     userCtx.ID,
		CreatedAt:     time.Now(),
	}
	if bug.Description == "" {
		bug.Description = "Pinned feedback"
	}
	if _, err := s.store.C("bugs").InsertOne(c.Request.Context(), bug); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create bug"})
		return
	}
	if !assigneeID.IsZero() {
		_, _ = s.store.C("notifications").InsertOne(c.Request.Context(), models.Notification{ID: primitive.NewObjectID(), UserID: assigneeID, Type: "bug_assigned", Content: "You were assigned a visual bug: " + bug.Description, RelatedID: bug.ID, CreatedAt: time.Now()})
	}
	s.notifyMentions(c.Request.Context(), website.TeamID, userCtx.ID, bug.Description, "feedback", bug.ID)
	c.JSON(http.StatusCreated, gin.H{"bug": bug})
}

func (s *Server) updateBug(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var bug models.Bug
	if err := s.store.C("bugs").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&bug); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "bug not found"})
		return
	}
	var website models.Website
	if err := s.store.C("websites").FindOne(c.Request.Context(), bson.M{"_id": bug.WebsiteID}).Decode(&website); err != nil || !s.canAccessTeam(c, website.TeamID) {
		return
	}
	var req struct {
		Description *string `json:"description"`
		Severity    *string `json:"severity"`
		Status      *string `json:"status"`
		AssigneeID  *string `json:"assignee_id"`
		Comment     *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bug update"})
		return
	}
	set := bson.M{}
	if req.Description != nil {
		set["description"] = strings.TrimSpace(*req.Description)
	}
	if req.Severity != nil {
		set["severity"] = strings.TrimSpace(*req.Severity)
	}
	if req.Status != nil {
		set["status"] = strings.TrimSpace(*req.Status)
	}
	if req.AssigneeID != nil {
		assigneeID, err := objectIDFromString(*req.AssigneeID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee_id"})
			return
		}
		set["assignee_id"] = assigneeID
	}
	update := bson.M{}
	if len(set) > 0 {
		update["$set"] = set
	}
	if req.Comment != nil && strings.TrimSpace(*req.Comment) != "" {
		comment := strings.TrimSpace(*req.Comment)
		update["$push"] = bson.M{"comments": models.Comment{ID: primitive.NewObjectID(), AuthorID: userCtx.ID, Content: comment, CreatedAt: time.Now()}}
		s.notifyMentions(c.Request.Context(), website.TeamID, userCtx.ID, comment, "comment", bug.ID)
	}
	if len(update) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no changes supplied"})
		return
	}
	_, err := s.store.C("bugs").UpdateByID(c.Request.Context(), id, update)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update bug"})
		return
	}
	if req.Description != nil {
		s.notifyMentions(c.Request.Context(), website.TeamID, userCtx.ID, strings.TrimSpace(*req.Description), "feedback", bug.ID)
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) convertBugToTask(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		ListID string `json:"list_id"`
		Title  string `json:"title"`
	}
	_ = c.ShouldBindJSON(&req)

	var bug models.Bug
	if err := s.store.C("bugs").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&bug); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "bug not found"})
		return
	}
	var website models.Website
	if err := s.store.C("websites").FindOne(c.Request.Context(), bson.M{"_id": bug.WebsiteID}).Decode(&website); err != nil || !s.canAccessTeam(c, website.TeamID) {
		return
	}
	listID := primitive.NilObjectID
	if strings.TrimSpace(req.ListID) != "" {
		parsed, err := objectIDFromString(req.ListID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list_id"})
			return
		}
		listID = parsed
	} else {
		listIDs, err := s.listIDsForTeam(c.Request.Context(), website.TeamID)
		if err != nil || len(listIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no task list exists for this team"})
			return
		}
		listID = listIDs[0]
	}
	taskTitle := strings.TrimSpace(req.Title)
	if taskTitle == "" {
		taskTitle = "Visual bug: " + bug.Description
	}
	task := models.Task{
		ID:          primitive.NewObjectID(),
		ListID:      listID,
		Title:       taskTitle,
		Description: "Created from website feedback on " + website.URL + "\nPin: " + formatPin(bug.PinX, bug.PinY) + "\nPage: " + bug.PageURL,
		Status:      "To Do",
		Priority:    bug.Severity,
		AssigneeIDs: []primitive.ObjectID{},
		Tags:        []string{"bug", "visual-feedback"},
		Checklist:   []models.ChecklistItem{},
		Attachments: []string{},
		Comments:    []models.Comment{},
		CreatedBy:   userCtx.ID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if !bug.AssigneeID.IsZero() {
		task.AssigneeIDs = append(task.AssigneeIDs, bug.AssigneeID)
	}
	if _, err := s.store.C("tasks").InsertOne(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create linked task"})
		return
	}
	_, _ = s.store.C("lists").UpdateByID(c.Request.Context(), listID, bson.M{"$addToSet": bson.M{"task_ids": task.ID}})
	_, _ = s.store.C("bugs").UpdateByID(c.Request.Context(), bug.ID, bson.M{"$set": bson.M{"linked_task_id": task.ID, "status": "In Progress"}})
	s.notifyAssignees(c.Request.Context(), task, "A visual bug was converted to a task: "+task.Title)
	c.JSON(http.StatusCreated, gin.H{"task": task})
}

func clampFloat(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func formatPin(x float64, y float64) string {
	return strings.TrimRight(strings.TrimRight(formatFloat(x), "0"), ".") + "%, " + strings.TrimRight(strings.TrimRight(formatFloat(y), "0"), ".") + "%"
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}
