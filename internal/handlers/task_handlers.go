package handlers

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) listSpaces(c *gin.Context) {
	teamID, ok := objectIDParam(c, "teamId")
	if !ok || !s.canAccessTeam(c, teamID) {
		return
	}
	cursor, err := s.store.C("spaces").Find(c.Request.Context(), bson.M{"team_id": teamID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load spaces"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var spaces []models.Space
	if err := cursor.All(c.Request.Context(), &spaces); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode spaces"})
		return
	}
	if spaces == nil {
		spaces = []models.Space{}
	}
	c.JSON(http.StatusOK, gin.H{"spaces": spaces})
}

func (s *Server) createSpace(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		TeamID string `json:"team_id"`
		Name   string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid space body"})
		return
	}
	teamID, err := objectIDFromString(req.TeamID)
	if err != nil || !s.canAccessTeam(c, teamID) || userCtx.TeamID != teamID {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "space name is required"})
		return
	}
	space := models.Space{ID: primitive.NewObjectID(), TeamID: teamID, Name: name, ProjectIDs: []primitive.ObjectID{}, CreatedAt: time.Now()}
	if _, err := s.store.C("spaces").InsertOne(c.Request.Context(), space); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create space"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"space": space})
}

func (s *Server) createProject(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		SpaceID string `json:"space_id"`
		Name    string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project body"})
		return
	}
	spaceID, err := objectIDFromString(req.SpaceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid space_id"})
		return
	}
	var space models.Space
	if err := s.store.C("spaces").FindOne(c.Request.Context(), bson.M{"_id": spaceID}).Decode(&space); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "space not found"})
		return
	}
	if !s.canAccessTeam(c, space.TeamID) || userCtx.TeamID != space.TeamID {
		return
	}
	if ok, limit := s.teamWithinProjectLimit(c, space.TeamID); !ok {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "project limit reached; upgrade your subscription", "limit": limit})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project name is required"})
		return
	}
	project := models.Project{ID: primitive.NewObjectID(), SpaceID: spaceID, Name: name, ListIDs: []primitive.ObjectID{}, CreatedAt: time.Now()}
	if _, err := s.store.C("projects").InsertOne(c.Request.Context(), project); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create project"})
		return
	}
	_, _ = s.store.C("spaces").UpdateByID(c.Request.Context(), spaceID, bson.M{"$addToSet": bson.M{"project_ids": project.ID}})
	c.JSON(http.StatusCreated, gin.H{"project": project})
}

func (s *Server) listProjectLists(c *gin.Context) {
	projectID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var project models.Project
	if err := s.store.C("projects").FindOne(c.Request.Context(), bson.M{"_id": projectID}).Decode(&project); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	teamID, err := s.teamForProject(c.Request.Context(), project.ID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	cursor, err := s.store.C("lists").Find(c.Request.Context(), bson.M{"project_id": projectID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load lists"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var lists []models.List
	if err := cursor.All(c.Request.Context(), &lists); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode lists"})
		return
	}
	if lists == nil {
		lists = []models.List{}
	}
	c.JSON(http.StatusOK, gin.H{"project": project, "lists": lists})
}

func (s *Server) createList(c *gin.Context) {
	var req struct {
		ProjectID string   `json:"project_id"`
		Name      string   `json:"name"`
		Statuses  []string `json:"statuses"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list body"})
		return
	}
	projectID, err := objectIDFromString(req.ProjectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project_id"})
		return
	}
	teamID, err := s.teamForProject(c.Request.Context(), projectID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "list name is required"})
		return
	}
	list := models.List{ID: primitive.NewObjectID(), ProjectID: projectID, Name: name, Statuses: stringsOrDefault(req.Statuses, []string{"To Do", "In Progress", "Done"}), TaskIDs: []primitive.ObjectID{}, CreatedAt: time.Now()}
	if _, err := s.store.C("lists").InsertOne(c.Request.Context(), list); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create list"})
		return
	}
	_, _ = s.store.C("projects").UpdateByID(c.Request.Context(), projectID, bson.M{"$addToSet": bson.M{"list_ids": list.ID}})
	c.JSON(http.StatusCreated, gin.H{"list": list})
}

func (s *Server) listInboxComments(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if userCtx.TeamID.IsZero() {
		c.JSON(http.StatusOK, gin.H{"comments": []gin.H{}, "projects": []gin.H{}, "unread_count": 0})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	s.ensureUserIdentity(c.Request.Context(), &user)
	projectFilter := primitive.NilObjectID
	if raw := strings.TrimSpace(c.Query("project_id")); raw != "" {
		projectFilter, err = objectIDFromString(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project_id"})
			return
		}
	}
	mentionFilter := strings.TrimSpace(c.Query("mention"))
	if mentionFilter == "" {
		mentionFilter = "all"
	}
	if mentionFilter != "all" && mentionFilter != "mention_me" && mentionFilter != "mention_others" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mention filter"})
		return
	}
	projects, listProjectIDs, listNames, listIDs, err := s.inboxProjectContext(c.Request.Context(), userCtx.TeamID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load inbox projects"})
		return
	}
	unreadCount := s.unreadTaskCommentCount(c.Request.Context(), userCtx.ID, userCtx.TeamID)
	if !projectFilter.IsZero() {
		filteredListIDs := []primitive.ObjectID{}
		for _, listID := range listIDs {
			if listProjectIDs[listID] == projectFilter {
				filteredListIDs = append(filteredListIDs, listID)
			}
		}
		listIDs = filteredListIDs
	}
	if len(listIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"comments": []gin.H{}, "projects": projects, "unread_count": unreadCount})
		return
	}
	usersByID, teamUsernames := s.teamUserLookup(c.Request.Context(), userCtx.TeamID)
	cursor, err := s.store.C("tasks").Find(c.Request.Context(), bson.M{"list_id": bson.M{"$in": listIDs}}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(300))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load inbox comments"})
		return
	}
	defer cursor.Close(c.Request.Context())
	type inboxRow struct {
		createdAt time.Time
		data      gin.H
	}
	rows := []inboxRow{}
	currentUsername := strings.ToLower(user.Username)
	projectNames := map[primitive.ObjectID]string{}
	for _, project := range projects {
		id, _ := project["id"].(primitive.ObjectID)
		name, _ := project["name"].(string)
		projectNames[id] = name
	}
	for cursor.Next(c.Request.Context()) {
		var task models.Task
		if cursor.Decode(&task) != nil {
			continue
		}
		projectID := listProjectIDs[task.ListID]
		for _, comment := range task.Comments {
			isUnread := !commentReadBy(comment, userCtx.ID)
			mentionMe, mentionOthers := commentMentionFlags(comment.Content, currentUsername, teamUsernames)
			if mentionFilter == "mention_me" && !mentionMe {
				continue
			}
			if mentionFilter == "mention_others" && !mentionOthers {
				continue
			}
			author := usersByID[comment.AuthorID]
			authorName := strings.TrimSpace(author.Name)
			if authorName == "" {
				authorName = firstNonEmpty(author.Username, author.Email, "Unknown")
			}
			rows = append(rows, inboxRow{
				createdAt: comment.CreatedAt,
				data: gin.H{
					"id":               comment.ID,
					"task_id":          task.ID,
					"task_title":       task.Title,
					"task_status":      task.Status,
					"task_priority":    task.Priority,
					"task_description": task.Description,
					"project_id":       projectID,
					"project_name":     projectNames[projectID],
					"list_name":        listNames[task.ListID],
					"comment":          comment.Content,
					"author_id":        comment.AuthorID,
					"author_name":      authorName,
					"author_username":  author.Username,
					"created_at":       comment.CreatedAt,
					"read":             !isUnread,
					"mention_me":       mentionMe,
					"mention_others":   mentionOthers,
				},
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].createdAt.After(rows[j].createdAt)
	})
	out := make([]gin.H, 0, len(rows))
	for i, row := range rows {
		if i >= 500 {
			break
		}
		out = append(out, row.data)
	}
	c.JSON(http.StatusOK, gin.H{"comments": out, "projects": projects, "unread_count": unreadCount})
}

func (s *Server) listTasks(c *gin.Context) {
	userCtx, _ := currentUser(c)
	filter := bson.M{}
	if listIDRaw := strings.TrimSpace(c.Query("list_id")); listIDRaw != "" {
		listID, err := objectIDFromString(listIDRaw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list_id"})
			return
		}
		teamID, err := s.teamForList(c.Request.Context(), listID)
		if err != nil || !s.canAccessTeam(c, teamID) {
			return
		}
		filter["list_id"] = listID
	} else if userCtx.Role != models.RoleOwnerAdmin {
		listIDs, err := s.listIDsForTeam(c.Request.Context(), userCtx.TeamID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not resolve team lists"})
			return
		}
		filter["list_id"] = bson.M{"$in": listIDs}
	}
	if assignee := strings.TrimSpace(c.Query("assignee")); assignee != "" {
		id, err := objectIDFromString(assignee)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee"})
			return
		}
		filter["assignee_ids"] = id
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		filter["status"] = status
	}
	if tag := strings.TrimSpace(c.Query("tag")); tag != "" {
		filter["tags"] = tag
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		filter["title"] = bson.M{"$regex": regexp.QuoteMeta(q), "$options": "i"}
	}
	cursor, err := s.store.C("tasks").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(250))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load tasks"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var tasks []models.Task
	if err := cursor.All(c.Request.Context(), &tasks); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode tasks"})
		return
	}
	if tasks == nil {
		tasks = []models.Task{}
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

func (s *Server) getTask(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	var list models.List
	_ = s.store.C("lists").FindOne(c.Request.Context(), bson.M{"_id": task.ListID}).Decode(&list)
	var project models.Project
	if !list.ProjectID.IsZero() {
		_ = s.store.C("projects").FindOne(c.Request.Context(), bson.M{"_id": list.ProjectID}).Decode(&project)
	}
	userIDs := []primitive.ObjectID{task.CreatedBy}
	userIDs = append(userIDs, task.AssigneeIDs...)
	for _, comment := range task.Comments {
		userIDs = append(userIDs, comment.AuthorID)
	}
	users := s.usersForIDs(c.Request.Context(), uniqueObjectIDs(userIDs))
	c.JSON(http.StatusOK, gin.H{"task": task, "list": list, "project": project, "users": users})
}

func (s *Server) createTask(c *gin.Context) {
	userCtx, _ := currentUser(c)
	if userCtx.Role != models.RoleTeamAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "only team admins can create tasks directly"})
		return
	}
	var req struct {
		ListID          string   `json:"list_id"`
		Title           string   `json:"title"`
		Description     string   `json:"description"`
		Status          string   `json:"status"`
		Priority        string   `json:"priority"`
		AssigneeIDs     []string `json:"assignee_ids"`
		DueDate         string   `json:"due_date"`
		StartDate       string   `json:"start_date"`
		Tags            []string `json:"tags"`
		EstimateMinutes int      `json:"estimate_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task body"})
		return
	}
	task, err := s.buildTaskFromRequest(c, req.ListID, req.Title, req.Description, req.Status, req.Priority, req.AssigneeIDs, req.DueDate, req.StartDate, req.Tags, req.EstimateMinutes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	task.CreatedBy = userCtx.ID
	task.CreatedAt = time.Now()
	task.UpdatedAt = task.CreatedAt
	if _, err := s.store.C("tasks").InsertOne(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create task"})
		return
	}
	_, _ = s.store.C("lists").UpdateByID(c.Request.Context(), task.ListID, bson.M{"$addToSet": bson.M{"task_ids": task.ID}})
	s.notifyAssignees(c.Request.Context(), task, "You were assigned: "+task.Title)
	if teamID, err := s.teamForList(c.Request.Context(), task.ListID); err == nil {
		s.notifyMentions(c.Request.Context(), teamID, userCtx.ID, task.Title+" "+task.Description, "task", task.ID)
	}
	c.JSON(http.StatusCreated, gin.H{"task": task})
}

func (s *Server) updateTask(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	if isInvitedCompanyRole(userCtx.Role) && !containsObjectID(task.AssigneeIDs, userCtx.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "members can only update assigned tasks"})
		return
	}

	var req struct {
		Title           *string  `json:"title"`
		Description     *string  `json:"description"`
		Status          *string  `json:"status"`
		Priority        *string  `json:"priority"`
		AssigneeIDs     []string `json:"assignee_ids"`
		DueDate         *string  `json:"due_date"`
		StartDate       *string  `json:"start_date"`
		Tags            []string `json:"tags"`
		EstimateMinutes *int     `json:"estimate_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task update"})
		return
	}
	set := bson.M{"updated_at": time.Now()}
	if req.Title != nil {
		set["title"] = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		set["description"] = *req.Description
	}
	if req.Status != nil {
		set["status"] = strings.TrimSpace(*req.Status)
	}
	if req.Priority != nil {
		set["priority"] = strings.TrimSpace(*req.Priority)
	}
	if len(req.AssigneeIDs) > 0 {
		if isInvitedCompanyRole(userCtx.Role) {
			c.JSON(http.StatusForbidden, gin.H{"error": "members cannot change assignees"})
			return
		}
		ids, err := objectIDsFromStrings(req.AssigneeIDs)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assignee id"})
			return
		}
		set["assignee_ids"] = ids
	}
	if req.DueDate != nil {
		date, err := parseOptionalDate(*req.DueDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid due_date"})
			return
		}
		set["due_date"] = date
	}
	if req.StartDate != nil {
		date, err := parseOptionalDate(*req.StartDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date"})
			return
		}
		set["start_date"] = date
	}
	if req.Tags != nil {
		set["tags"] = req.Tags
	}
	if req.EstimateMinutes != nil {
		set["estimate_minutes"] = *req.EstimateMinutes
	}
	if _, err := s.store.C("tasks").UpdateByID(c.Request.Context(), id, bson.M{"$set": set}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update task"})
		return
	}
	if req.Title != nil || req.Description != nil {
		content := task.Title + " " + task.Description
		if req.Title != nil {
			content = strings.TrimSpace(*req.Title) + " " + task.Description
		}
		if req.Description != nil {
			content = content + " " + strings.TrimSpace(*req.Description)
		}
		s.notifyMentions(c.Request.Context(), teamID, userCtx.ID, content, "task", id)
	}
	s.audit(c.Request.Context(), userCtx.ID, "task.updated", "task", id)
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (s *Server) deleteTask(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) || userCtx.TeamID != teamID {
		return
	}
	_, err = s.store.C("tasks").DeleteOne(c.Request.Context(), bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete task"})
		return
	}
	_, _ = s.store.C("lists").UpdateByID(c.Request.Context(), task.ListID, bson.M{"$pull": bson.M{"task_ids": id}})
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) addTaskComment(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	if isInvitedCompanyRole(userCtx.Role) && !containsObjectID(task.AssigneeIDs, userCtx.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "members can only comment on assigned tasks"})
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment body"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comment is required"})
		return
	}
	comment := models.Comment{ID: primitive.NewObjectID(), AuthorID: userCtx.ID, Content: content, CreatedAt: time.Now(), ReadBy: []primitive.ObjectID{userCtx.ID}}
	_, err = s.store.C("tasks").UpdateByID(c.Request.Context(), id, bson.M{"$push": bson.M{"comments": comment}, "$set": bson.M{"updated_at": time.Now()}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not add comment"})
		return
	}
	s.notifyMentions(c.Request.Context(), teamID, userCtx.ID, content, "comment", id)
	c.JSON(http.StatusCreated, gin.H{"comment": comment})
}

func (s *Server) markTaskCommentRead(c *gin.Context) {
	userCtx, _ := currentUser(c)
	taskID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	commentID, ok := objectIDParam(c, "commentId")
	if !ok {
		return
	}
	var task models.Task
	if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), task.ListID)
	if err != nil || !s.canAccessTeam(c, teamID) {
		return
	}
	res, err := s.store.C("tasks").UpdateOne(c.Request.Context(), bson.M{"_id": taskID, "comments.id": commentID}, bson.M{"$addToSet": bson.M{"comments.$.read_by": userCtx.ID}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not mark comment as read"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
		return
	}
	unreadCount := s.unreadTaskCommentCount(c.Request.Context(), userCtx.ID, userCtx.TeamID)
	c.JSON(http.StatusOK, gin.H{"read": true, "unread_count": unreadCount})
}

func (s *Server) buildTaskFromRequest(c *gin.Context, listIDRaw string, title string, description string, status string, priority string, assigneeIDsRaw []string, dueDateRaw string, startDateRaw string, tags []string, estimate int) (models.Task, error) {
	listID, err := objectIDFromString(listIDRaw)
	if err != nil {
		return models.Task{}, errors.New("invalid list_id")
	}
	teamID, err := s.teamForList(c.Request.Context(), listID)
	if err != nil {
		return models.Task{}, errors.New("list not found")
	}
	if !s.canAccessTeam(c, teamID) {
		return models.Task{}, errors.New("team access denied")
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return models.Task{}, errors.New("title is required")
	}
	if status == "" {
		status = "To Do"
	}
	if priority == "" {
		priority = "Normal"
	}
	assigneeIDs, err := objectIDsFromStrings(assigneeIDsRaw)
	if err != nil {
		return models.Task{}, errors.New("invalid assignee id")
	}
	dueDate, err := parseOptionalDate(dueDateRaw)
	if err != nil {
		return models.Task{}, errors.New("invalid due_date")
	}
	startDate, err := parseOptionalDate(startDateRaw)
	if err != nil {
		return models.Task{}, errors.New("invalid start_date")
	}
	return models.Task{
		ID:              primitive.NewObjectID(),
		ListID:          listID,
		Title:           title,
		Description:     description,
		Status:          status,
		Priority:        priority,
		AssigneeIDs:     assigneeIDs,
		DueDate:         dueDate,
		StartDate:       startDate,
		Tags:            tags,
		Checklist:       []models.ChecklistItem{},
		Attachments:     []string{},
		Comments:        []models.Comment{},
		EstimateMinutes: estimate,
	}, nil
}

func (s *Server) notifyAssignees(ctx context.Context, task models.Task, content string) {
	for _, assigneeID := range task.AssigneeIDs {
		_, _ = s.store.C("notifications").InsertOne(ctx, models.Notification{
			ID:        primitive.NewObjectID(),
			UserID:    assigneeID,
			Type:      "task_assigned",
			Content:   content,
			RelatedID: task.ID,
			Read:      false,
			CreatedAt: time.Now(),
		})
	}
}

func (s *Server) inboxProjectContext(ctx context.Context, teamID primitive.ObjectID) ([]gin.H, map[primitive.ObjectID]primitive.ObjectID, map[primitive.ObjectID]string, []primitive.ObjectID, error) {
	spaceCursor, err := s.store.C("spaces").Find(ctx, bson.M{"team_id": teamID})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer spaceCursor.Close(ctx)
	projectIDs := []primitive.ObjectID{}
	for spaceCursor.Next(ctx) {
		var space models.Space
		if spaceCursor.Decode(&space) == nil {
			projectIDs = append(projectIDs, space.ProjectIDs...)
		}
	}
	if len(projectIDs) == 0 {
		return []gin.H{}, map[primitive.ObjectID]primitive.ObjectID{}, map[primitive.ObjectID]string{}, []primitive.ObjectID{}, nil
	}
	projectCursor, err := s.store.C("projects").Find(ctx, bson.M{"_id": bson.M{"$in": projectIDs}}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer projectCursor.Close(ctx)
	projects := []gin.H{}
	for projectCursor.Next(ctx) {
		var project models.Project
		if projectCursor.Decode(&project) == nil {
			projects = append(projects, gin.H{"id": project.ID, "name": project.Name})
		}
	}
	listCursor, err := s.store.C("lists").Find(ctx, bson.M{"project_id": bson.M{"$in": projectIDs}})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer listCursor.Close(ctx)
	listProjectIDs := map[primitive.ObjectID]primitive.ObjectID{}
	listNames := map[primitive.ObjectID]string{}
	listIDs := []primitive.ObjectID{}
	for listCursor.Next(ctx) {
		var list models.List
		if listCursor.Decode(&list) == nil {
			listIDs = append(listIDs, list.ID)
			listProjectIDs[list.ID] = list.ProjectID
			listNames[list.ID] = list.Name
		}
	}
	return projects, listProjectIDs, listNames, listIDs, nil
}

func (s *Server) teamUserLookup(ctx context.Context, teamID primitive.ObjectID) (map[primitive.ObjectID]models.User, map[string]bool) {
	cursor, err := s.store.C("users").Find(ctx, bson.M{"team_id": teamID, "status": models.StatusActive}, options.Find().SetProjection(bson.M{"password_hash": 0, "refresh_token_hash": 0, "two_factor_secret": 0}))
	if err != nil {
		return map[primitive.ObjectID]models.User{}, map[string]bool{}
	}
	defer cursor.Close(ctx)
	usersByID := map[primitive.ObjectID]models.User{}
	usernames := map[string]bool{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) == nil {
			usersByID[user.ID] = user
			if user.Username != "" {
				usernames[strings.ToLower(user.Username)] = true
			}
		}
	}
	return usersByID, usernames
}

func (s *Server) usersForIDs(ctx context.Context, ids []primitive.ObjectID) []models.User {
	if len(ids) == 0 {
		return []models.User{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{"password_hash": 0, "refresh_token_hash": 0, "two_factor_secret": 0}))
	if err != nil {
		return []models.User{}
	}
	defer cursor.Close(ctx)
	users := []models.User{}
	for cursor.Next(ctx) {
		var user models.User
		if cursor.Decode(&user) == nil {
			users = append(users, user)
		}
	}
	return users
}

func commentReadBy(comment models.Comment, userID primitive.ObjectID) bool {
	if comment.AuthorID == userID {
		return true
	}
	return containsObjectID(comment.ReadBy, userID)
}

func commentMentionFlags(content string, currentUsername string, teamUsernames map[string]bool) (bool, bool) {
	mentionMe := false
	mentionOthers := false
	for _, match := range mentionPattern.FindAllStringSubmatch(content, -1) {
		username := strings.ToLower(match[1])
		if username == currentUsername && currentUsername != "" {
			mentionMe = true
			continue
		}
		if teamUsernames[username] {
			mentionOthers = true
		}
	}
	return mentionMe, mentionOthers
}

func (s *Server) unreadTaskCommentCount(ctx context.Context, userID primitive.ObjectID, teamID primitive.ObjectID) int {
	if teamID.IsZero() {
		return 0
	}
	listIDs, err := s.listIDsForTeam(ctx, teamID)
	if err != nil || len(listIDs) == 0 {
		return 0
	}
	cursor, err := s.store.C("tasks").Find(ctx, bson.M{"list_id": bson.M{"$in": listIDs}}, options.Find().SetProjection(bson.M{"comments": 1}).SetLimit(1000))
	if err != nil {
		return 0
	}
	defer cursor.Close(ctx)
	count := 0
	for cursor.Next(ctx) {
		var task models.Task
		if cursor.Decode(&task) != nil {
			continue
		}
		for _, comment := range task.Comments {
			if !commentReadBy(comment, userID) {
				count++
			}
		}
	}
	return count
}

func (s *Server) teamForProject(ctx context.Context, projectID primitive.ObjectID) (primitive.ObjectID, error) {
	var project models.Project
	if err := s.store.C("projects").FindOne(ctx, bson.M{"_id": projectID}).Decode(&project); err != nil {
		return primitive.NilObjectID, err
	}
	var space models.Space
	if err := s.store.C("spaces").FindOne(ctx, bson.M{"_id": project.SpaceID}).Decode(&space); err != nil {
		return primitive.NilObjectID, err
	}
	return space.TeamID, nil
}

func (s *Server) teamForList(ctx context.Context, listID primitive.ObjectID) (primitive.ObjectID, error) {
	var list models.List
	if err := s.store.C("lists").FindOne(ctx, bson.M{"_id": listID}).Decode(&list); err != nil {
		return primitive.NilObjectID, err
	}
	return s.teamForProject(ctx, list.ProjectID)
}

func (s *Server) listIDsForTeam(ctx context.Context, teamID primitive.ObjectID) ([]primitive.ObjectID, error) {
	spaceCursor, err := s.store.C("spaces").Find(ctx, bson.M{"team_id": teamID})
	if err != nil {
		return nil, err
	}
	defer spaceCursor.Close(ctx)
	projectIDs := []primitive.ObjectID{}
	for spaceCursor.Next(ctx) {
		var space models.Space
		if spaceCursor.Decode(&space) == nil {
			projectIDs = append(projectIDs, space.ProjectIDs...)
		}
	}
	if len(projectIDs) == 0 {
		return []primitive.ObjectID{}, nil
	}
	listCursor, err := s.store.C("lists").Find(ctx, bson.M{"project_id": bson.M{"$in": projectIDs}})
	if err != nil {
		return nil, err
	}
	defer listCursor.Close(ctx)
	listIDs := []primitive.ObjectID{}
	for listCursor.Next(ctx) {
		var list models.List
		if listCursor.Decode(&list) == nil {
			listIDs = append(listIDs, list.ID)
		}
	}
	return listIDs, nil
}

func (s *Server) teamWithinProjectLimit(c *gin.Context, teamID primitive.ObjectID) (bool, int) {
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID}).Decode(&team); err != nil {
		return false, 0
	}
	var sub models.Subscription
	if err := s.store.C("subscriptions").FindOne(c.Request.Context(), bson.M{"_id": team.SubscriptionID}).Decode(&sub); err != nil {
		return true, 0
	}
	var plan models.Plan
	if err := s.store.C("plans").FindOne(c.Request.Context(), bson.M{"_id": sub.PlanID}).Decode(&plan); err != nil || plan.ProjectLimit <= 0 {
		return true, 0
	}
	cursor, err := s.store.C("spaces").Find(c.Request.Context(), bson.M{"team_id": teamID})
	if err != nil {
		return false, plan.ProjectLimit
	}
	defer cursor.Close(c.Request.Context())
	count := 0
	for cursor.Next(c.Request.Context()) {
		var space models.Space
		if cursor.Decode(&space) == nil {
			count += len(space.ProjectIDs)
		}
	}
	return count < plan.ProjectLimit, plan.ProjectLimit
}
