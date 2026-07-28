package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const clientTaskTransferKind = "pinflow_client_tasks"

type clientTaskTransferBundle struct {
	Kind       string                 `json:"kind"`
	Version    int                    `json:"version"`
	Scope      string                 `json:"scope,omitempty"`
	ExportedAt time.Time              `json:"exported_at,omitempty"`
	Projects   []models.ClientProject `json:"projects"`
	Domains    []models.ClientWebsite `json:"domains"`
	Tabs       []models.ClientTab     `json:"tabs"`
	Tasks      []models.ClientTask    `json:"tasks"`
}

func (s *Server) exportClientTasksJSON(c *gin.Context) {
	userCtx, _, ok := s.activeClientTransferUser(c)
	if !ok {
		return
	}
	clients, err := s.reportAllowedClientProjects(c.Request.Context(), userCtx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load accessible folders"})
		return
	}
	allowedClientIDs := make([]primitive.ObjectID, 0, len(clients))
	for _, client := range clients {
		if !client.ID.IsZero() {
			allowedClientIDs = append(allowedClientIDs, client.ID)
		}
	}
	if len(allowedClientIDs) == 0 {
		c.JSON(http.StatusOK, clientTaskTransferBundle{Kind: clientTaskTransferKind, Version: 1, Scope: "empty", ExportedAt: time.Now(), Projects: []models.ClientProject{}, Domains: []models.ClientWebsite{}, Tabs: []models.ClientTab{}, Tasks: []models.ClientTask{}})
		return
	}

	scope := strings.ToLower(strings.TrimSpace(c.DefaultQuery("scope", "all")))
	filter := bson.M{"client_id": bson.M{"$in": allowedClientIDs}}
	if raw := strings.TrimSpace(c.Query("client_id")); raw != "" {
		clientID, err := objectIDFromString(raw)
		if err != nil || !containsObjectID(allowedClientIDs, clientID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project folder"})
			return
		}
		filter["client_id"] = clientID
		if scope == "all" {
			scope = "client"
		}
	}
	if raw := strings.TrimSpace(c.Query("website_id")); raw != "" {
		websiteID, err := objectIDFromString(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain"})
			return
		}
		var site models.ClientWebsite
		if err := s.store.C("client_websites").FindOne(c.Request.Context(), bson.M{"_id": websiteID, "client_id": bson.M{"$in": allowedClientIDs}}).Decode(&site); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "domain access denied"})
			return
		}
		filter["website_id"] = websiteID
		scope = "domain"
	}
	if raw := strings.TrimSpace(c.Query("task_id")); raw != "" {
		taskID, err := objectIDFromString(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task"})
			return
		}
		filter["_id"] = taskID
		scope = "task"
	}
	if scope == "assigned" {
		filter["assignee_ids"] = userCtx.ID
	}

	cursor, err := s.store.C("client_tasks").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "client_id", Value: 1}, {Key: "website_id", Value: 1}, {Key: "created_at", Value: -1}}).SetLimit(5000))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not export tasks"})
		return
	}
	defer cursor.Close(c.Request.Context())
	tasks := []models.ClientTask{}
	if err := cursor.All(c.Request.Context(), &tasks); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode tasks"})
		return
	}

	projectIDs := []primitive.ObjectID{}
	websiteIDs := []primitive.ObjectID{}
	tabIDs := []primitive.ObjectID{}
	for _, task := range tasks {
		projectIDs = append(projectIDs, task.ClientID)
		websiteIDs = append(websiteIDs, task.WebsiteID)
		tabIDs = append(tabIDs, task.TabID)
	}
	if clientID, ok := filter["client_id"].(primitive.ObjectID); ok {
		projectIDs = append(projectIDs, clientID)
	}
	if websiteID, ok := filter["website_id"].(primitive.ObjectID); ok {
		websiteIDs = append(websiteIDs, websiteID)
	}
	projectIDs = uniqueObjectIDs(projectIDs)
	websiteIDs = uniqueObjectIDs(websiteIDs)
	tabIDs = uniqueObjectIDs(tabIDs)

	exportProjects := []models.ClientProject{}
	for _, client := range clients {
		if containsObjectID(projectIDs, client.ID) {
			exportProjects = append(exportProjects, client)
		}
	}
	exportDomains := s.clientTransferWebsites(c.Request.Context(), allowedClientIDs, websiteIDs, projectIDs)
	for _, site := range exportDomains {
		if !containsObjectID(websiteIDs, site.ID) {
			websiteIDs = append(websiteIDs, site.ID)
		}
	}
	exportTabs := s.clientTransferTabs(c.Request.Context(), websiteIDs, tabIDs)

	bundle := clientTaskTransferBundle{
		Kind:       clientTaskTransferKind,
		Version:    1,
		Scope:      scope,
		ExportedAt: time.Now(),
		Projects:   exportProjects,
		Domains:    exportDomains,
		Tabs:       exportTabs,
		Tasks:      tasks,
	}
	c.Header("Content-Disposition", `attachment; filename="pinflow-tasks-`+safeTransferFilePart(scope)+`.json"`)
	c.JSON(http.StatusOK, bundle)
}

func (s *Server) importClientTasks(c *gin.Context) {
	userCtx, user, ok := s.activeClientTransferUser(c)
	if !ok {
		return
	}
	var bundle clientTaskTransferBundle
	if err := c.ShouldBindJSON(&bundle); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task import file"})
		return
	}
	if bundle.Kind != "" && bundle.Kind != clientTaskTransferKind {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this JSON file is not a PinFlow task export"})
		return
	}
	if len(bundle.Tasks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the import file does not contain tasks"})
		return
	}
	if len(bundle.Tasks) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "import is limited to 1000 tasks at once"})
		return
	}

	projectByOldID := map[primitive.ObjectID]models.ClientProject{}
	for _, project := range bundle.Projects {
		if !project.ID.IsZero() {
			projectByOldID[project.ID] = project
		}
	}
	domainByOldID := map[primitive.ObjectID]models.ClientWebsite{}
	for _, domain := range bundle.Domains {
		if !domain.ID.IsZero() {
			domainByOldID[domain.ID] = domain
		}
	}
	tabsByOldWebsiteID := map[primitive.ObjectID][]models.ClientTab{}
	tabByOldID := map[primitive.ObjectID]models.ClientTab{}
	for _, tab := range bundle.Tabs {
		if tab.Type != "task_board" {
			continue
		}
		if !tab.ID.IsZero() {
			tabByOldID[tab.ID] = tab
		}
		tabsByOldWebsiteID[tab.WebsiteID] = append(tabsByOldWebsiteID[tab.WebsiteID], tab)
	}

	targetClient, hasTargetClient, ok := s.clientTransferTargetClient(c)
	if !ok {
		return
	}
	targetWebsite, hasTargetWebsite, ok := s.clientTransferTargetWebsite(c)
	if !ok {
		return
	}
	if hasTargetWebsite {
		targetClient = s.clientTransferClientForWebsite(c.Request.Context(), targetWebsite)
		hasTargetClient = true
	}

	importedClients := map[primitive.ObjectID]models.ClientProject{}
	importedWebsites := map[primitive.ObjectID]models.ClientWebsite{}
	importedTabs := map[primitive.ObjectID]models.ClientTab{}
	now := time.Now()
	importedCount := 0

	for _, sourceTask := range bundle.Tasks {
		client := targetClient
		if !hasTargetClient {
			sourceClient := projectByOldID[sourceTask.ClientID]
			if sourceClient.ID.IsZero() {
				sourceClient = models.ClientProject{ID: sourceTask.ClientID, Name: "Imported project"}
			}
			var err error
			client, err = s.ensureImportedClientProject(c.Request.Context(), userCtx, user, sourceClient, importedClients)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}

		site := targetWebsite
		if !hasTargetWebsite {
			sourceSite := domainByOldID[sourceTask.WebsiteID]
			if sourceSite.ID.IsZero() {
				sourceSite = models.ClientWebsite{ID: sourceTask.WebsiteID, Name: "Imported domain"}
			}
			var err error
			site, err = s.ensureImportedClientWebsite(c.Request.Context(), userCtx, client, sourceSite, importedWebsites)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}

		sourceTab := tabByOldID[sourceTask.TabID]
		if sourceTab.ID.IsZero() {
			sourceTabs := tabsByOldWebsiteID[sourceTask.WebsiteID]
			if len(sourceTabs) > 0 {
				sourceTab = sourceTabs[0]
			}
		}
		tab, err := s.ensureImportedTaskBoard(c.Request.Context(), userCtx, site, sourceTab, importedTabs)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		task := cloneImportedClientTask(sourceTask, client, site, tab, userCtx.ID, now)
		if _, err := s.store.C("client_tasks").InsertOne(c.Request.Context(), task); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not import tasks"})
			return
		}
		s.recordClientTaskLog(c.Request.Context(), task, userCtx.ID, "created_task", "imported this task")
		s.notifyClientTaskAssignees(c.Request.Context(), task)
		s.broadcastClientTaskChanged(c.Request.Context(), task, userCtx.ID, "client_task_created")
		importedCount++
	}

	c.JSON(http.StatusCreated, gin.H{"imported": importedCount})
}

func (s *Server) activeClientTransferUser(c *gin.Context) (middleware.UserContext, models.User, bool) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil || user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "user account is not active"})
		return userCtx, models.User{}, false
	}
	userCtx.Role = user.Role
	userCtx.TeamID = user.TeamID
	return userCtx, user, true
}

func (s *Server) clientTransferTargetClient(c *gin.Context) (models.ClientProject, bool, bool) {
	raw := strings.TrimSpace(c.Query("client_id"))
	if raw == "" {
		return models.ClientProject{}, false, true
	}
	clientID, err := objectIDFromString(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project folder"})
		return models.ClientProject{}, false, false
	}
	client, ok := s.loadClientProjectForAccess(c, clientID, true)
	return client, ok, ok
}

func (s *Server) clientTransferTargetWebsite(c *gin.Context) (models.ClientWebsite, bool, bool) {
	raw := strings.TrimSpace(c.Query("website_id"))
	if raw == "" {
		return models.ClientWebsite{}, false, true
	}
	websiteID, err := objectIDFromString(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain"})
		return models.ClientWebsite{}, false, false
	}
	site, ok := s.loadClientWebsiteForAccess(c, websiteID, true)
	return site, ok, ok
}

func (s *Server) clientTransferClientForWebsite(ctx context.Context, site models.ClientWebsite) models.ClientProject {
	var client models.ClientProject
	_ = s.store.C("client_projects").FindOne(ctx, bson.M{"_id": site.ClientID}).Decode(&client)
	return client
}

func (s *Server) clientTransferWebsites(ctx context.Context, allowedClientIDs, websiteIDs, projectIDs []primitive.ObjectID) []models.ClientWebsite {
	filter := bson.M{"client_id": bson.M{"$in": allowedClientIDs}}
	if len(websiteIDs) > 0 {
		filter["_id"] = bson.M{"$in": websiteIDs}
	} else if len(projectIDs) > 0 {
		filter["client_id"] = bson.M{"$in": projectIDs}
	}
	cursor, err := s.store.C("client_websites").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return []models.ClientWebsite{}
	}
	defer cursor.Close(ctx)
	rows := []models.ClientWebsite{}
	_ = cursor.All(ctx, &rows)
	return rows
}

func (s *Server) clientTransferTabs(ctx context.Context, websiteIDs, tabIDs []primitive.ObjectID) []models.ClientTab {
	if len(websiteIDs) == 0 && len(tabIDs) == 0 {
		return []models.ClientTab{}
	}
	filter := bson.M{"type": "task_board"}
	if len(tabIDs) > 0 {
		filter["_id"] = bson.M{"$in": tabIDs}
	} else {
		filter["website_id"] = bson.M{"$in": websiteIDs}
	}
	cursor, err := s.store.C("client_tabs").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		return []models.ClientTab{}
	}
	defer cursor.Close(ctx)
	rows := []models.ClientTab{}
	_ = cursor.All(ctx, &rows)
	return rows
}

func (s *Server) ensureImportedClientProject(ctx context.Context, userCtx middleware.UserContext, user models.User, source models.ClientProject, cache map[primitive.ObjectID]models.ClientProject) (models.ClientProject, error) {
	if cached, ok := cache[source.ID]; ok {
		return cached, nil
	}
	var existing models.ClientProject
	if !source.ID.IsZero() {
		if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": source.ID}).Decode(&existing); err == nil && s.canManageClientProject(ctx, userCtx, existing) {
			cache[source.ID] = existing
			return existing, nil
		}
	}
	if userCtx.Role == models.RoleOwnerAdmin {
		return models.ClientProject{}, fmt.Errorf("owner admin can import into an existing folder or domain only")
	}
	team, err := s.personalTeamForUser(ctx, user, time.Now())
	if err != nil {
		return models.ClientProject{}, err
	}
	name := strings.TrimSpace(source.Name)
	if name == "" {
		name = "Imported project"
	}
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"team_id": team.ID, "name": name}).Decode(&existing); err == nil && s.canManageClientProject(ctx, userCtx, existing) {
		cache[source.ID] = existing
		return existing, nil
	}
	now := time.Now()
	client := models.ClientProject{
		ID:             primitive.NewObjectID(),
		TeamID:         team.ID,
		Name:           name,
		CompanyEmail:   strings.ToLower(strings.TrimSpace(source.CompanyEmail)),
		ContactName:    strings.TrimSpace(source.ContactName),
		Details:        strings.TrimSpace(source.Details),
		MemberIDs:      []primitive.ObjectID{userCtx.ID},
		ClientAdminIDs: []primitive.ObjectID{},
		CreatedBy:      userCtx.ID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if _, err := s.store.C("client_projects").InsertOne(ctx, client); err != nil {
		return models.ClientProject{}, err
	}
	cache[source.ID] = client
	return client, nil
}

func (s *Server) ensureImportedClientWebsite(ctx context.Context, userCtx middleware.UserContext, client models.ClientProject, source models.ClientWebsite, cache map[primitive.ObjectID]models.ClientWebsite) (models.ClientWebsite, error) {
	if cached, ok := cache[source.ID]; ok {
		return cached, nil
	}
	name := strings.TrimSpace(source.Name)
	if name == "" {
		name = "Imported domain"
	}
	var existing models.ClientWebsite
	if err := s.store.C("client_websites").FindOne(ctx, bson.M{"client_id": client.ID, "name": name}).Decode(&existing); err == nil {
		cache[source.ID] = existing
		return existing, nil
	}
	now := time.Now()
	site := models.ClientWebsite{
		ID:        primitive.NewObjectID(),
		ClientID:  client.ID,
		TeamID:    client.TeamID,
		Name:      name,
		URL:       normalizeOptionalURL(source.URL),
		Details:   strings.TrimSpace(source.Details),
		CreatedBy: userCtx.ID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.store.C("client_websites").InsertOne(ctx, site); err != nil {
		return models.ClientWebsite{}, err
	}
	cache[source.ID] = site
	return site, nil
}

func (s *Server) ensureImportedTaskBoard(ctx context.Context, userCtx middleware.UserContext, site models.ClientWebsite, source models.ClientTab, cache map[primitive.ObjectID]models.ClientTab) (models.ClientTab, error) {
	if !source.ID.IsZero() {
		if cached, ok := cache[source.ID]; ok {
			return cached, nil
		}
	}
	title := strings.TrimSpace(source.Title)
	if title == "" {
		title = "Imported tasks"
	}
	var existing models.ClientTab
	if err := s.store.C("client_tabs").FindOne(ctx, bson.M{"website_id": site.ID, "type": "task_board", "title": title}).Decode(&existing); err == nil {
		if !source.ID.IsZero() {
			cache[source.ID] = existing
		}
		return existing, nil
	}
	statuses := normalizeClientTaskStatuses(source.Statuses)
	now := time.Now()
	tab := models.ClientTab{
		ID:           primitive.NewObjectID(),
		ClientID:     site.ClientID,
		WebsiteID:    site.ID,
		TeamID:       site.TeamID,
		Type:         "task_board",
		Title:        title,
		Content:      strings.TrimSpace(source.Content),
		Statuses:     statuses,
		StatusStyles: normalizeClientTaskStatusStyles(statuses, source.StatusStyles),
		CreatedBy:    userCtx.ID,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := s.store.C("client_tabs").InsertOne(ctx, tab); err != nil {
		return models.ClientTab{}, err
	}
	if !source.ID.IsZero() {
		cache[source.ID] = tab
	}
	return tab, nil
}

func cloneImportedClientTask(source models.ClientTask, client models.ClientProject, site models.ClientWebsite, tab models.ClientTab, actorID primitive.ObjectID, now time.Time) models.ClientTask {
	statuses := normalizeClientTaskStatuses(tab.Statuses)
	status := normalizeClientTaskStatus(source.Status)
	if status == "" || !containsString(statuses, status) {
		status = statuses[0]
	}
	taskType := strings.ToLower(strings.TrimSpace(source.Type))
	if taskType != "annotation" {
		taskType = "description"
	}
	content := normalizeClientTaskContent(source.Content)
	checklist := normalizeClientTaskChecklist(source.Checklist)
	blocks := normalizeClientTaskBlocks(source.Blocks)
	if taskType == "description" {
		if len(blocks) == 0 {
			blocks = clientTaskBlocksFromLegacy(content, checklist)
		}
		if content == "" {
			content = firstClientTaskBlockContent(blocks)
		}
		if len(checklist) == 0 {
			checklist = flattenClientTaskBlockChecklist(blocks)
		}
	}
	assignees := importedTaskAssignees(source.AssigneeIDs, client)
	task := models.ClientTask{
		ID:          primitive.NewObjectID(),
		ClientID:    client.ID,
		WebsiteID:   site.ID,
		TabID:       tab.ID,
		TeamID:      client.TeamID,
		Type:        taskType,
		Title:       firstNonEmpty(normalizeClientTaskTitle(source.Title), "Imported task"),
		Content:     content,
		URL:         strings.TrimSpace(source.URL),
		Comment:     normalizeClientTaskContent(source.Comment),
		PageWidth:   normalizeAnnotationPageDimension(source.PageWidth, 320, 8000),
		PageHeight:  normalizeAnnotationPageDimension(source.PageHeight, 900, 50000),
		Attachments: compactStrings(source.Attachments),
		Checklist:   checklist,
		Blocks:      blocks,
		AssigneeIDs: assignees,
		DueDate:     source.DueDate,
		Recurrence:  normalizeClientTaskRecurrence(source.Recurrence, source.DueDate),
		Status:      status,
		CreatedBy:   actorID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if source.PinX != nil && source.PinY != nil {
		x := clampFloat(*source.PinX, 0, 100)
		y := clampFloat(*source.PinY, 0, 100)
		task.PinX = &x
		task.PinY = &y
	}
	if taskType == "annotation" {
		task.Content = ""
		task.Checklist = []models.ChecklistItem{}
		task.Blocks = []models.ClientTaskBlock{}
		task.Annotations = normalizeClientTaskAnnotations(source.Annotations, statuses, actorID, now)
	}
	return task
}

func importedTaskAssignees(source []primitive.ObjectID, client models.ClientProject) []primitive.ObjectID {
	allowed := uniqueObjectIDs(append(append([]primitive.ObjectID{}, client.MemberIDs...), client.ClientAdminIDs...))
	out := []primitive.ObjectID{}
	for _, id := range source {
		if containsObjectID(allowed, id) {
			out = append(out, id)
		}
	}
	return uniqueObjectIDs(out)
}

func safeTransferFilePart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "tasks"
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "tasks"
	}
	return b.String()
}
