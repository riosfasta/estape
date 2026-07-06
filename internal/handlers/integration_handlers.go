package handlers

import (
	"net/http"
	"strings"
	"time"

	"bugmark/internal/integrations"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *Server) listIntegrations(c *gin.Context) {
	userCtx, _ := currentUser(c)
	cursor, err := s.store.C("integrations").Find(c.Request.Context(), bson.M{"team_id": userCtx.TeamID}, options.Find().SetSort(bson.D{{Key: "connected_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load integrations"})
		return
	}
	defer cursor.Close(c.Request.Context())
	var rows []models.Integration
	if err := cursor.All(c.Request.Context(), &rows); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode integrations"})
		return
	}
	if rows == nil {
		rows = []models.Integration{}
	}
	c.JSON(http.StatusOK, gin.H{"integrations": rows})
}

func (s *Server) connectIntegration(c *gin.Context) {
	userCtx, _ := currentUser(c)
	providerName := strings.ToLower(c.Param("provider"))
	if _, ok := s.integrations[providerName]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	var req struct {
		APIKey string `json:"api_key"`
	}
	_ = c.ShouldBindJSON(&req)
	authType := "oauth2"
	credentials := "oauth-ready"
	if providerName == "bugherd" {
		authType = "api_key"
		if strings.TrimSpace(req.APIKey) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "BugHerd requires an API key"})
			return
		}
		credentials = "local-dev:" + strings.TrimSpace(req.APIKey)
	}
	row := models.Integration{
		ID:                   primitive.NewObjectID(),
		TeamID:               userCtx.TeamID,
		Provider:             providerName,
		AuthType:             authType,
		CredentialsEncrypted: credentials,
		ConnectedBy:          userCtx.ID,
		ConnectedAt:          time.Now(),
		Status:               "active",
	}
	_, err := s.store.C("integrations").UpdateOne(
		c.Request.Context(),
		bson.M{"team_id": userCtx.TeamID, "provider": providerName},
		bson.M{"$set": row},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not connect integration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"integration": row, "oauth_url": s.cfg.AppURL + "/api/integrations/" + providerName + "/callback"})
}

func (s *Server) integrationCallback(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"connected": true, "provider": c.Param("provider")})
}

func (s *Server) disconnectIntegration(c *gin.Context) {
	userCtx, _ := currentUser(c)
	providerName := strings.ToLower(c.Param("provider"))
	_, err := s.store.C("integrations").DeleteOne(c.Request.Context(), bson.M{"team_id": userCtx.TeamID, "provider": providerName})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not disconnect integration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disconnected": true})
}

func (s *Server) integrationProjects(c *gin.Context) {
	userCtx, _ := currentUser(c)
	providerName := strings.ToLower(c.Param("provider"))
	provider, ok := s.integrations[providerName]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	count, _ := s.store.C("integrations").CountDocuments(c.Request.Context(), bson.M{"team_id": userCtx.TeamID, "provider": providerName, "status": "active"})
	if count == 0 {
		c.JSON(http.StatusPreconditionFailed, gin.H{"error": "connect this provider first"})
		return
	}
	_ = provider.RefreshAuth(c.Request.Context())
	projects, err := provider.ListProjects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "provider project lookup failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func (s *Server) startImport(c *gin.Context) {
	userCtx, _ := currentUser(c)
	providerName := strings.ToLower(c.Param("provider"))
	provider, ok := s.integrations[providerName]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	var req struct {
		ExternalProjectID string                 `json:"external_project_id"`
		TargetListID      string                 `json:"target_list_id"`
		FieldMapping      map[string]interface{} `json:"field_mapping"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid import body"})
		return
	}
	listID, err := objectIDFromString(req.TargetListID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target_list_id"})
		return
	}
	teamID, err := s.teamForList(c.Request.Context(), listID)
	if err != nil || !s.canAccessTeam(c, teamID) || teamID != userCtx.TeamID {
		return
	}
	job := models.ImportJob{ID: primitive.NewObjectID(), TeamID: teamID, Provider: providerName, ExternalProjectID: req.ExternalProjectID, TargetListID: listID, FieldMapping: req.FieldMapping, Status: "running", Errors: []string{}, CreatedBy: userCtx.ID, CreatedAt: time.Now()}
	_, _ = s.store.C("import_jobs").InsertOne(c.Request.Context(), job)
	_ = provider.RefreshAuth(c.Request.Context())
	externalTasks, err := provider.FetchTasks(c.Request.Context(), req.ExternalProjectID)
	if err != nil {
		_, _ = s.store.C("import_jobs").UpdateByID(c.Request.Context(), job.ID, bson.M{"$set": bson.M{"status": "failed", "errors": []string{err.Error()}}})
		c.JSON(http.StatusBadGateway, gin.H{"error": "provider import failed"})
		return
	}
	imported := 0
	skipped := 0
	for _, externalTask := range externalTasks {
		exists, _ := s.store.C("tasks").CountDocuments(c.Request.Context(), bson.M{"external_ref.provider": providerName, "external_ref.external_id": externalTask.ID})
		if exists > 0 {
			skipped++
			continue
		}
		task := taskFromExternal(listID, userCtx.ID, providerName, externalTask)
		if _, err := s.store.C("tasks").InsertOne(c.Request.Context(), task); err != nil {
			continue
		}
		_, _ = s.store.C("lists").UpdateByID(c.Request.Context(), listID, bson.M{"$addToSet": bson.M{"task_ids": task.ID}})
		imported++
	}
	_, _ = s.store.C("import_jobs").UpdateByID(c.Request.Context(), job.ID, bson.M{"$set": bson.M{"status": "completed", "total": len(externalTasks), "imported_count": imported, "skipped_count": skipped}})
	job.Status = "completed"
	job.Total = len(externalTasks)
	job.ImportedCount = imported
	job.SkippedCount = skipped
	c.JSON(http.StatusAccepted, gin.H{"job": job})
}

func (s *Server) getImportJob(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var job models.ImportJob
	if err := s.store.C("import_jobs").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "import job not found"})
		return
	}
	if !s.canAccessTeam(c, job.TeamID) || (userCtx.Role != models.RoleOwnerAdmin && userCtx.TeamID != job.TeamID) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

func (s *Server) startExport(c *gin.Context) {
	userCtx, _ := currentUser(c)
	providerName := strings.ToLower(c.Param("provider"))
	provider, ok := s.integrations[providerName]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}
	var req struct {
		TaskIDs           []string               `json:"task_ids"`
		ExternalProjectID string                 `json:"external_project_id"`
		FieldMapping      map[string]interface{} `json:"field_mapping"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.TaskIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_ids and external_project_id are required"})
		return
	}
	taskIDs, err := objectIDsFromStrings(req.TaskIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}
	job := models.ExportJob{ID: primitive.NewObjectID(), TeamID: userCtx.TeamID, Provider: providerName, TaskIDs: taskIDs, ExternalProjectID: req.ExternalProjectID, FieldMapping: req.FieldMapping, Status: "running", Errors: []string{}, CreatedBy: userCtx.ID, CreatedAt: time.Now()}
	_, _ = s.store.C("export_jobs").InsertOne(c.Request.Context(), job)
	exported := 0
	for _, taskID := range taskIDs {
		var task models.Task
		if err := s.store.C("tasks").FindOne(c.Request.Context(), bson.M{"_id": taskID}).Decode(&task); err != nil {
			continue
		}
		teamID, err := s.teamForList(c.Request.Context(), task.ListID)
		if err != nil || teamID != userCtx.TeamID {
			continue
		}
		created, err := provider.CreateTask(c.Request.Context(), req.ExternalProjectID, integrations.ExternalTask{Title: task.Title, Description: task.Description, Status: task.Status, Priority: task.Priority, Tags: task.Tags})
		if err != nil {
			continue
		}
		_, _ = s.store.C("tasks").UpdateByID(c.Request.Context(), taskID, bson.M{"$set": bson.M{"external_ref": models.ExternalRef{Provider: providerName, ExternalID: created.ID, ExternalURL: created.URL}}})
		exported++
	}
	_, _ = s.store.C("export_jobs").UpdateByID(c.Request.Context(), job.ID, bson.M{"$set": bson.M{"status": "completed", "exported_count": exported}})
	job.Status = "completed"
	job.ExportedCount = exported
	c.JSON(http.StatusAccepted, gin.H{"job": job})
}

func (s *Server) getExportJob(c *gin.Context) {
	userCtx, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	var job models.ExportJob
	if err := s.store.C("export_jobs").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "export job not found"})
		return
	}
	if !s.canAccessTeam(c, job.TeamID) || (userCtx.Role != models.RoleOwnerAdmin && userCtx.TeamID != job.TeamID) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

func taskFromExternal(listID primitive.ObjectID, userID primitive.ObjectID, provider string, externalTask integrations.ExternalTask) models.Task {
	now := time.Now()
	status := externalTask.Status
	if status == "" {
		status = "To Do"
	}
	priority := externalTask.Priority
	if priority == "" {
		priority = "Normal"
	}
	return models.Task{
		ID:          primitive.NewObjectID(),
		ListID:      listID,
		Title:       externalTask.Title,
		Description: externalTask.Description,
		Status:      status,
		Priority:    priority,
		Tags:        externalTask.Tags,
		Checklist:   []models.ChecklistItem{},
		Attachments: []string{},
		Comments:    []models.Comment{},
		ExternalRef: models.ExternalRef{Provider: provider, ExternalID: externalTask.ID, ExternalURL: externalTask.URL},
		CreatedBy:   userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}
