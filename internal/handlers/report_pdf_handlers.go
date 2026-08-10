package handlers

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type taskReportQuery struct {
	Scope       string
	Period      string
	DateField   string
	ClientID    primitive.ObjectID
	WebsiteID   primitive.ObjectID
	TaskID      primitive.ObjectID
	From        time.Time
	To          time.Time
	HasDateSpan bool
	Options     taskReportOptions
	Note        string
}

type taskReportOptions struct {
	Summary     bool `json:"summary"`
	Completions bool `json:"completions"`
	Tasks       bool `json:"tasks"`
	Content     bool `json:"content"`
	Checklist   bool `json:"checklist"`
	Assignees   bool `json:"assignees"`
	DueDates    bool `json:"due_dates"`
	Time        bool `json:"time"`
}

type taskReportData struct {
	User        models.User
	Clients     []models.ClientProject
	Websites    []models.ClientWebsite
	Tasks       []models.ClientTask
	Completions []taskReportCompletion
	UsersByID   map[primitive.ObjectID]models.User
	TimeMinutes map[primitive.ObjectID]int
	Query       taskReportQuery
	GeneratedAt time.Time
}

type taskReportCompletion struct {
	Task      models.ClientTask
	Log       models.ClientTaskLog
	Recurring bool
}

func (s *Server) taskReportPDF(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil || user.Status != models.StatusActive {
		c.JSON(403, gin.H{"error": "user account is not active"})
		return
	}
	userCtx.Role = user.Role
	userCtx.TeamID = user.TeamID

	query, err := parseTaskReportQuery(c)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	data, err := s.buildTaskReportData(c.Request.Context(), c, userCtx, user, query)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	pdf := renderTaskReportPDF(data)
	filename := fmt.Sprintf("task-report-%s.pdf", strings.ReplaceAll(query.Period, " ", "-"))
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(200, "application/pdf", pdf)
}

func (s *Server) taskReportPreview(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil || user.Status != models.StatusActive {
		c.JSON(403, gin.H{"error": "user account is not active"})
		return
	}
	userCtx.Role = user.Role
	userCtx.TeamID = user.TeamID

	query, err := parseTaskReportQuery(c)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	data, err := s.buildTaskReportData(c.Request.Context(), c, userCtx, user, query)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, taskReportPreviewPayload(data))
}

func parseTaskReportQuery(c *gin.Context) (taskReportQuery, error) {
	now := time.Now()
	query := taskReportQuery{
		Scope:     strings.ToLower(strings.TrimSpace(c.DefaultQuery("scope", "assigned"))),
		Period:    strings.ToLower(strings.TrimSpace(c.DefaultQuery("period", "week"))),
		DateField: strings.ToLower(strings.TrimSpace(c.DefaultQuery("date_field", "created_at"))),
		Options:   parseTaskReportOptions(c),
		Note:      normalizeTaskReportNote(c.Query("note")),
	}
	switch query.Scope {
	case "assigned", "all", "domain", "task":
	default:
		query.Scope = "assigned"
	}
	switch query.DateField {
	case "created_at", "updated_at", "due_date":
	default:
		query.DateField = "created_at"
	}
	if raw := strings.TrimSpace(c.Query("client_id")); raw != "" {
		id, err := objectIDFromString(raw)
		if err != nil {
			return query, fmt.Errorf("invalid project folder")
		}
		query.ClientID = id
	}
	if raw := strings.TrimSpace(c.Query("website_id")); raw != "" {
		id, err := objectIDFromString(raw)
		if err != nil {
			return query, fmt.Errorf("invalid domain")
		}
		query.WebsiteID = id
	}
	if raw := strings.TrimSpace(c.Query("task_id")); raw != "" {
		id, err := objectIDFromString(raw)
		if err != nil {
			return query, fmt.Errorf("invalid task")
		}
		query.TaskID = id
		query.Scope = "task"
	}
	if query.Scope == "domain" && query.WebsiteID.IsZero() {
		return query, fmt.Errorf("select a domain for domain export")
	}
	if query.Scope == "task" && query.TaskID.IsZero() {
		return query, fmt.Errorf("select a task for task export")
	}

	fromRaw := strings.TrimSpace(c.Query("from"))
	toRaw := strings.TrimSpace(c.Query("to"))
	if fromRaw != "" || toRaw != "" {
		if fromRaw != "" {
			parsed, err := time.ParseInLocation("2006-01-02", fromRaw, now.Location())
			if err != nil {
				return query, fmt.Errorf("invalid from date")
			}
			query.From = parsed
			query.HasDateSpan = true
		}
		if toRaw != "" {
			parsed, err := time.ParseInLocation("2006-01-02", toRaw, now.Location())
			if err != nil {
				return query, fmt.Errorf("invalid to date")
			}
			query.To = parsed.Add(24 * time.Hour)
			query.HasDateSpan = true
		}
		query.Period = "custom"
		return query, nil
	}

	from, to, hasRange := reportPeriodRange(query.Period, now)
	query.From = from
	query.To = to
	query.HasDateSpan = hasRange
	return query, nil
}

func defaultTaskReportOptions() taskReportOptions {
	return taskReportOptions{
		Summary:     true,
		Completions: true,
		Tasks:       true,
		Content:     true,
		Checklist:   true,
		Assignees:   true,
		DueDates:    true,
		Time:        true,
	}
}

func parseTaskReportOptions(c *gin.Context) taskReportOptions {
	options := defaultTaskReportOptions()
	if strings.TrimSpace(c.Query("customize")) == "" {
		return options
	}
	options.Summary = reportQueryEnabled(c, "include_summary")
	options.Completions = reportQueryEnabled(c, "include_completions")
	options.Tasks = reportQueryEnabled(c, "include_tasks")
	options.Content = reportQueryEnabled(c, "include_content")
	options.Checklist = reportQueryEnabled(c, "include_checklist")
	options.Assignees = reportQueryEnabled(c, "include_assignees")
	options.DueDates = reportQueryEnabled(c, "include_due_dates")
	options.Time = reportQueryEnabled(c, "include_time")
	return options
}

func reportQueryEnabled(c *gin.Context, key string) bool {
	value := strings.ToLower(strings.TrimSpace(c.Query(key)))
	return value == "1" || value == "true" || value == "on" || value == "yes"
}

func normalizeTaskReportNote(value string) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > 2000 {
		value = strings.TrimSpace(string(runes[:2000]))
	}
	return value
}

func reportPeriodRange(period string, now time.Time) (time.Time, time.Time, bool) {
	year, month, day := now.Date()
	location := now.Location()
	today := time.Date(year, month, day, 0, 0, 0, 0, location)
	switch period {
	case "day", "daily", "today":
		return today, today.AddDate(0, 0, 1), true
	case "week", "weekly":
		weekday := int(today.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := today.AddDate(0, 0, -(weekday - 1))
		return start, start.AddDate(0, 0, 7), true
	case "month", "monthly":
		start := time.Date(year, month, 1, 0, 0, 0, 0, location)
		return start, start.AddDate(0, 1, 0), true
	case "year", "yearly":
		start := time.Date(year, 1, 1, 0, 0, 0, 0, location)
		return start, start.AddDate(1, 0, 0), true
	default:
		return time.Time{}, time.Time{}, false
	}
}

func (s *Server) buildTaskReportData(ctx context.Context, c *gin.Context, userCtx middleware.UserContext, user models.User, query taskReportQuery) (taskReportData, error) {
	clients, err := s.reportAllowedClientProjects(ctx, userCtx)
	if err != nil {
		return taskReportData{}, err
	}
	if !query.ClientID.IsZero() {
		filtered := []models.ClientProject{}
		for _, client := range clients {
			if client.ID == query.ClientID {
				filtered = append(filtered, client)
			}
		}
		clients = filtered
	}
	if len(clients) == 0 {
		return taskReportData{User: user, Query: query, GeneratedAt: time.Now(), UsersByID: map[primitive.ObjectID]models.User{}, TimeMinutes: map[primitive.ObjectID]int{}}, nil
	}
	clientIDs := make([]primitive.ObjectID, 0, len(clients))
	for _, client := range clients {
		clientIDs = append(clientIDs, client.ID)
	}

	websites, err := s.reportWebsites(ctx, clientIDs, query.WebsiteID)
	if err != nil {
		return taskReportData{}, err
	}
	if !query.WebsiteID.IsZero() {
		allowedWebsite := false
		for _, website := range websites {
			if website.ID == query.WebsiteID {
				allowedWebsite = true
				break
			}
		}
		if !allowedWebsite {
			return taskReportData{}, fmt.Errorf("domain access denied")
		}
	}

	if userCtx.Role != models.RoleOwnerAdmin {
		access := s.clientAccessSets(ctx, userCtx)
		filteredWebsites := []models.ClientWebsite{}
		for _, website := range websites {
			if containsObjectID(access.FullClientIDs, website.ClientID) || containsObjectID(access.WebsiteIDs, website.ID) {
				filteredWebsites = append(filteredWebsites, website)
			}
		}
		websites = filteredWebsites
	}

	taskFilter := s.clientTaskAccessFilter(ctx, userCtx, clientIDs)
	if query.Scope == "assigned" {
		taskFilter = bson.M{"$and": []bson.M{taskFilter, {"assignee_ids": userCtx.ID}}}
	}
	if !query.WebsiteID.IsZero() {
		taskFilter = bson.M{"$and": []bson.M{taskFilter, {"website_id": query.WebsiteID}}}
	}
	if !query.TaskID.IsZero() {
		taskFilter = bson.M{"$and": []bson.M{taskFilter, {"_id": query.TaskID}}}
	}
	completionTaskFilter := taskFilter
	if query.HasDateSpan {
		dateRange := bson.M{}
		if !query.From.IsZero() {
			dateRange["$gte"] = query.From
		}
		if !query.To.IsZero() {
			dateRange["$lt"] = query.To
		}
		taskFilter = bson.M{"$and": []bson.M{taskFilter, {query.DateField: dateRange}}}
	}

	cursor, err := s.store.C("client_tasks").Find(ctx, taskFilter, options.Find().SetSort(bson.D{{Key: "client_id", Value: 1}, {Key: "website_id", Value: 1}, {Key: "due_date", Value: 1}, {Key: "created_at", Value: -1}}).SetLimit(2000))
	if err != nil {
		return taskReportData{}, fmt.Errorf("could not load report tasks")
	}
	defer cursor.Close(ctx)
	tasks := []models.ClientTask{}
	if err := cursor.All(ctx, &tasks); err != nil {
		return taskReportData{}, fmt.Errorf("could not decode report tasks")
	}

	completions := s.reportTaskCompletions(ctx, completionTaskFilter, query)
	reportTasks := mergeReportTasks(tasks, completionTasks(completions))
	usersByID := s.reportUsersByID(ctx, reportTasks, completions)
	timeMinutes := s.reportTaskTimeMinutes(ctx, reportTasks, query, userCtx)
	return taskReportData{
		User:        user,
		Clients:     clients,
		Websites:    websites,
		Tasks:       tasks,
		Completions: completions,
		UsersByID:   usersByID,
		TimeMinutes: timeMinutes,
		Query:       query,
		GeneratedAt: time.Now(),
	}, nil
}

func (s *Server) reportAllowedClientProjects(ctx context.Context, userCtx middleware.UserContext) ([]models.ClientProject, error) {
	filter := bson.M{}
	if userCtx.Role != models.RoleOwnerAdmin {
		access := s.clientAccessSets(ctx, userCtx)
		clientIDs := uniqueObjectIDs(append(append([]primitive.ObjectID{}, access.FullClientIDs...), access.DomainClientIDs...))
		if len(clientIDs) == 0 {
			return []models.ClientProject{}, nil
		}
		filter["_id"] = bson.M{"$in": clientIDs}
	}
	cursor, err := s.store.C("client_projects").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("could not load project folders")
	}
	defer cursor.Close(ctx)
	clients := []models.ClientProject{}
	if err := cursor.All(ctx, &clients); err != nil {
		return nil, fmt.Errorf("could not decode project folders")
	}
	allowed := []models.ClientProject{}
	for _, client := range clients {
		allowed = append(allowed, client)
	}
	return allowed, nil
}

func (s *Server) reportWebsites(ctx context.Context, clientIDs []primitive.ObjectID, websiteID primitive.ObjectID) ([]models.ClientWebsite, error) {
	if len(clientIDs) == 0 {
		return []models.ClientWebsite{}, nil
	}
	filter := bson.M{"client_id": bson.M{"$in": clientIDs}}
	if !websiteID.IsZero() {
		filter["_id"] = websiteID
	}
	cursor, err := s.store.C("client_websites").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("could not load domains")
	}
	defer cursor.Close(ctx)
	websites := []models.ClientWebsite{}
	if err := cursor.All(ctx, &websites); err != nil {
		return nil, fmt.Errorf("could not decode domains")
	}
	return websites, nil
}

func (s *Server) reportTaskCompletions(ctx context.Context, taskFilter bson.M, query taskReportQuery) []taskReportCompletion {
	taskCursor, err := s.store.C("client_tasks").Find(ctx, taskFilter, options.Find().SetProjection(bson.M{"content": 0, "blocks": 0, "checklist": 0}).SetLimit(5000))
	if err != nil {
		return []taskReportCompletion{}
	}
	defer taskCursor.Close(ctx)
	tasks := []models.ClientTask{}
	if taskCursor.All(ctx, &tasks) != nil || len(tasks) == 0 {
		return []taskReportCompletion{}
	}
	taskIDs := make([]primitive.ObjectID, 0, len(tasks))
	taskByID := map[primitive.ObjectID]models.ClientTask{}
	for _, task := range tasks {
		taskIDs = append(taskIDs, task.ID)
		taskByID[task.ID] = task
	}
	logFilter := bson.M{
		"task_id": bson.M{"$in": uniqueObjectIDs(taskIDs)},
		"action":  bson.M{"$in": []string{"completed_recurrence", "updated_status"}},
	}
	if query.HasDateSpan {
		dateRange := bson.M{}
		if !query.From.IsZero() {
			dateRange["$gte"] = query.From
		}
		if !query.To.IsZero() {
			dateRange["$lt"] = query.To
		}
		logFilter["created_at"] = dateRange
	}
	logCursor, err := s.store.C("client_task_logs").Find(ctx, logFilter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(1000))
	if err != nil {
		return []taskReportCompletion{}
	}
	defer logCursor.Close(ctx)
	completions := []taskReportCompletion{}
	for logCursor.Next(ctx) {
		var log models.ClientTaskLog
		if logCursor.Decode(&log) != nil || !reportTaskLogIsCompletion(log) {
			continue
		}
		task, ok := taskByID[log.TaskID]
		if !ok {
			continue
		}
		completions = append(completions, taskReportCompletion{
			Task:      task,
			Log:       log,
			Recurring: log.Action == "completed_recurrence",
		})
	}
	return completions
}

func completionTasks(completions []taskReportCompletion) []models.ClientTask {
	tasks := make([]models.ClientTask, 0, len(completions))
	for _, completion := range completions {
		tasks = append(tasks, completion.Task)
	}
	return tasks
}

func mergeReportTasks(primary []models.ClientTask, secondary []models.ClientTask) []models.ClientTask {
	out := append([]models.ClientTask{}, primary...)
	seen := map[primitive.ObjectID]bool{}
	for _, task := range out {
		seen[task.ID] = true
	}
	for _, task := range secondary {
		if seen[task.ID] {
			continue
		}
		out = append(out, task)
		seen[task.ID] = true
	}
	return out
}

func reportTaskLogIsCompletion(log models.ClientTaskLog) bool {
	if log.Action == "completed_recurrence" {
		return true
	}
	if log.Action != "updated_status" {
		return false
	}
	detail := strings.ToLower(strings.TrimSpace(log.Detail))
	index := strings.LastIndex(detail, " to ")
	if index < 0 {
		return false
	}
	return isReportDoneStatus(strings.TrimSpace(detail[index+4:]))
}

func (s *Server) reportUsersByID(ctx context.Context, tasks []models.ClientTask, completions []taskReportCompletion) map[primitive.ObjectID]models.User {
	ids := []primitive.ObjectID{}
	for _, task := range tasks {
		ids = append(ids, task.AssigneeIDs...)
		ids = append(ids, task.CreatedBy)
		for _, annotation := range task.Annotations {
			ids = append(ids, annotation.AssigneeIDs...)
			ids = append(ids, annotation.CreatedBy)
		}
	}
	for _, completion := range completions {
		ids = append(ids, completion.Log.ActorID)
	}
	ids = uniqueObjectIDs(ids)
	if len(ids) == 0 {
		return map[primitive.ObjectID]models.User{}
	}
	cursor, err := s.store.C("users").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{"password_hash": 0, "refresh_token_hash": 0, "two_factor_secret": 0}))
	if err != nil {
		return map[primitive.ObjectID]models.User{}
	}
	defer cursor.Close(ctx)
	users := []models.User{}
	_ = cursor.All(ctx, &users)
	byID := map[primitive.ObjectID]models.User{}
	for _, user := range users {
		byID[user.ID] = user
	}
	return byID
}

func (s *Server) reportTaskTimeMinutes(ctx context.Context, tasks []models.ClientTask, query taskReportQuery, userCtx middleware.UserContext) map[primitive.ObjectID]int {
	taskIDs := []primitive.ObjectID{}
	for _, task := range tasks {
		taskIDs = append(taskIDs, task.ID)
	}
	taskIDs = uniqueObjectIDs(taskIDs)
	if len(taskIDs) == 0 {
		return map[primitive.ObjectID]int{}
	}
	filter := bson.M{"task_id": bson.M{"$in": taskIDs}}
	if query.HasDateSpan {
		dateRange := bson.M{}
		if !query.From.IsZero() {
			dateRange["$gte"] = query.From
		}
		if !query.To.IsZero() {
			dateRange["$lt"] = query.To
		}
		filter["start_time"] = dateRange
	}
	if userCtx.Role == models.RoleMember {
		filter["user_id"] = userCtx.ID
	}
	cursor, err := s.store.C("time_entries").Find(ctx, filter)
	if err != nil {
		return map[primitive.ObjectID]int{}
	}
	defer cursor.Close(ctx)
	out := map[primitive.ObjectID]int{}
	for cursor.Next(ctx) {
		var entry models.TimeEntry
		if cursor.Decode(&entry) == nil {
			out[entry.TaskID] += entry.DurationMinutes
		}
	}
	return out
}

func renderTaskReportPDF(data taskReportData) []byte {
	pdf := newSimplePDF("Project Task Report", taskReportSubtitle(data))
	if data.Query.Options.Summary {
		pdf.section("Summary")
		total, done, open, overdue, annotationCount, tracked, completedEvents := taskReportSummary(data)
		pdf.kv("Generated for", userDisplayName(data.User))
		pdf.kv("Scope", reportScopeLabel(data.Query))
		pdf.kv("Date filter", reportDateFilterLabel(data.Query))
		pdf.kv("Completed in period", strconv.Itoa(completedEvents))
		pdf.kv("Total tasks", strconv.Itoa(total))
		pdf.kv("Done now", strconv.Itoa(done))
		pdf.kv("Open", strconv.Itoa(open))
		pdf.kv("Overdue", strconv.Itoa(overdue))
		pdf.kv("Annotation tasks", strconv.Itoa(annotationCount))
		if data.Query.Options.Time {
			pdf.kv("Tracked time", minutesReportLabel(tracked))
		}
		pdf.space(10)
	}

	clientByID := map[primitive.ObjectID]models.ClientProject{}
	for _, client := range data.Clients {
		clientByID[client.ID] = client
	}
	websiteByID := map[primitive.ObjectID]models.ClientWebsite{}
	for _, website := range data.Websites {
		websiteByID[website.ID] = website
	}
	if data.Query.Options.Completions && len(data.Completions) > 0 {
		pdf.section("Completed In This Period")
		for _, completion := range data.Completions {
			pdf.completionRow(completion, clientByID, websiteByID, data.UsersByID)
		}
		pdf.space(4)
	}
	if !data.Query.Options.Tasks {
		if !data.Query.Options.Summary && (!data.Query.Options.Completions || len(data.Completions) == 0) {
			pdf.section("Report")
			if data.Query.Options.Completions {
				pdf.paragraph("No completed work matched this report filter.")
			} else {
				pdf.paragraph("No report sections selected.")
			}
		}
		pdf.reportNote(data.Query.Note)
		return pdf.bytes()
	}
	grouped := map[primitive.ObjectID][]models.ClientTask{}
	for _, task := range data.Tasks {
		grouped[task.WebsiteID] = append(grouped[task.WebsiteID], task)
	}
	websites := append([]models.ClientWebsite{}, data.Websites...)
	sort.Slice(websites, func(i, j int) bool {
		if websites[i].ClientID == websites[j].ClientID {
			return strings.ToLower(websites[i].Name) < strings.ToLower(websites[j].Name)
		}
		return strings.ToLower(clientByID[websites[i].ClientID].Name) < strings.ToLower(clientByID[websites[j].ClientID].Name)
	})
	if len(data.Tasks) == 0 && len(data.Completions) == 0 {
		pdf.section("Tasks")
		pdf.paragraph("No matching tasks for this report filter.")
		pdf.reportNote(data.Query.Note)
		return pdf.bytes()
	}
	for _, website := range websites {
		tasks := grouped[website.ID]
		if len(tasks) == 0 {
			continue
		}
		client := clientByID[website.ClientID]
		pdf.section(client.Name + " / " + website.Name)
		if strings.TrimSpace(website.URL) != "" {
			pdf.small("Domain: " + website.URL)
		}
		for _, task := range tasks {
			pdf.taskRow(task, data.UsersByID, data.TimeMinutes[task.ID], data.Query.Options)
		}
	}
	for _, task := range data.Tasks {
		if !websiteByID[task.WebsiteID].ID.IsZero() {
			continue
		}
		pdf.taskRow(task, data.UsersByID, data.TimeMinutes[task.ID], data.Query.Options)
	}
	pdf.reportNote(data.Query.Note)
	return pdf.bytes()
}

func taskReportSubtitle(data taskReportData) string {
	return reportScopeLabel(data.Query) + " - " + reportDateFilterLabel(data.Query) + " - " + data.GeneratedAt.Format("Jan 2, 2006 15:04")
}

func taskReportSummary(data taskReportData) (total, done, open, overdue, annotationCount, tracked, completedEvents int) {
	now := time.Now()
	total = len(data.Tasks)
	completedEvents = len(data.Completions)
	trackedTaskIDs := map[primitive.ObjectID]bool{}
	for _, task := range data.Tasks {
		if isReportDoneStatus(task.Status) {
			done++
		} else {
			open++
		}
		if task.DueDate != nil && task.DueDate.Before(now) && !isReportDoneStatus(task.Status) {
			overdue++
		}
		if task.Type == "annotation" || len(task.Annotations) > 0 {
			annotationCount++
		}
		trackedTaskIDs[task.ID] = true
	}
	for _, completion := range data.Completions {
		trackedTaskIDs[completion.Task.ID] = true
	}
	for taskID := range trackedTaskIDs {
		tracked += data.TimeMinutes[taskID]
	}
	return
}

func taskReportPreviewPayload(data taskReportData) gin.H {
	total, done, open, overdue, annotationCount, tracked, completedEvents := taskReportSummary(data)
	clientByID := map[primitive.ObjectID]models.ClientProject{}
	for _, client := range data.Clients {
		clientByID[client.ID] = client
	}
	websiteByID := map[primitive.ObjectID]models.ClientWebsite{}
	for _, website := range data.Websites {
		websiteByID[website.ID] = website
	}
	payload := gin.H{
		"scope":             reportScopeLabel(data.Query),
		"date_filter":       reportDateFilterLabel(data.Query),
		"options":           data.Query.Options,
		"task_count":        len(data.Tasks),
		"completion_count":  len(data.Completions),
		"generated_at":      data.GeneratedAt.Format(time.RFC3339),
		"tasks":             []gin.H{},
		"completed_events":  []gin.H{},
		"more_tasks":        0,
		"more_completions":  0,
		"has_visible_data":  data.Query.Options.Summary || data.Query.Options.Completions || data.Query.Options.Tasks,
		"visible_task_rows": data.Query.Options.Tasks,
	}
	if data.Query.Note != "" {
		payload["note"] = data.Query.Note
	}
	if data.Query.Options.Summary {
		payload["summary"] = gin.H{
			"total_tasks":         total,
			"completed_in_period": completedEvents,
			"done_now":            done,
			"open":                open,
			"overdue":             overdue,
			"annotation_tasks":    annotationCount,
			"tracked_time":        minutesReportLabel(tracked),
		}
	}
	if data.Query.Options.Completions {
		completions := []gin.H{}
		for index, completion := range data.Completions {
			if index >= 20 {
				break
			}
			completions = append(completions, taskReportCompletionPreview(completion, clientByID, websiteByID, data.UsersByID))
		}
		payload["completed_events"] = completions
		if len(data.Completions) > len(completions) {
			payload["more_completions"] = len(data.Completions) - len(completions)
		}
	}
	if data.Query.Options.Tasks {
		tasks := []gin.H{}
		for index, task := range data.Tasks {
			if index >= 40 {
				break
			}
			tasks = append(tasks, taskReportTaskPreview(task, clientByID, websiteByID, data.UsersByID, data.TimeMinutes[task.ID], data.Query.Options))
		}
		payload["tasks"] = tasks
		if len(data.Tasks) > len(tasks) {
			payload["more_tasks"] = len(data.Tasks) - len(tasks)
		}
	}
	return payload
}

func taskReportTaskPreview(task models.ClientTask, clients map[primitive.ObjectID]models.ClientProject, websites map[primitive.ObjectID]models.ClientWebsite, users map[primitive.ObjectID]models.User, minutes int, options taskReportOptions) gin.H {
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = "Untitled task"
	}
	item := gin.H{
		"id":         task.ID.Hex(),
		"title":      title,
		"type":       task.Type,
		"status":     clientTaskStatusLogLabel(task.Status),
		"created_at": task.CreatedAt.Format("2006-01-02"),
		"project":    strings.TrimSpace(clients[task.ClientID].Name),
		"domain":     strings.TrimSpace(websites[task.WebsiteID].Name),
	}
	if options.DueDates && task.DueDate != nil {
		item["due_date"] = task.DueDate.Format("2006-01-02")
	}
	if options.Time {
		item["tracked_time"] = minutesReportLabel(minutes)
	}
	if options.Assignees {
		item["assignees"] = reportAssigneeNames(task.AssigneeIDs, users)
	}
	if options.Content {
		content := stripReportText(task.Content)
		if content == "" {
			content = stripReportText(task.Comment)
		}
		item["content"] = taskReportPreviewText(content, 180)
	}
	if options.Checklist {
		checklistItems := reportTaskChecklistItems(task)
		done, total := reportChecklistStats(checklistItems)
		previewItems := []gin.H{}
		for index, checklistItem := range checklistItems {
			if index >= 8 {
				break
			}
			previewItems = append(previewItems, gin.H{
				"text": checklistItem.Text,
				"done": checklistItem.Done,
			})
		}
		item["checklist"] = gin.H{
			"done":       done,
			"total":      total,
			"items":      previewItems,
			"more_items": maxInt(total-len(previewItems), 0),
		}
	}
	return item
}

func taskReportCompletionPreview(completion taskReportCompletion, clients map[primitive.ObjectID]models.ClientProject, websites map[primitive.ObjectID]models.ClientWebsite, users map[primitive.ObjectID]models.User) gin.H {
	task := completion.Task
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = "Untitled task"
	}
	actor := "Someone"
	if user, ok := users[completion.Log.ActorID]; ok {
		actor = userDisplayName(user)
	}
	return gin.H{
		"id":           completion.Log.ID.Hex(),
		"task_id":      task.ID.Hex(),
		"title":        title,
		"project":      strings.TrimSpace(clients[task.ClientID].Name),
		"domain":       strings.TrimSpace(websites[task.WebsiteID].Name),
		"actor":        actor,
		"completed_at": completion.Log.CreatedAt.Format("2006-01-02 15:04"),
		"detail":       strings.TrimSpace(completion.Log.Detail),
		"recurring":    completion.Recurring,
	}
}

func taskReportPreviewText(text string, limit int) string {
	text = stripReportText(text)
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimSpace(string(runes[:limit])) + "..."
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func minFloat(a float64, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func reportScopeLabel(query taskReportQuery) string {
	switch query.Scope {
	case "all":
		return "All tasks in accessible projects"
	case "domain":
		return "All tasks in selected domain"
	case "task":
		return "Single task"
	default:
		return "Assigned to me"
	}
}

func reportDateFilterLabel(query taskReportQuery) string {
	field := map[string]string{"created_at": "created", "updated_at": "updated", "due_date": "due"}[query.DateField]
	if field == "" {
		field = "created"
	}
	if !query.HasDateSpan {
		return "All time by " + field + " date"
	}
	if query.From.IsZero() {
		to := query.To.Add(-time.Nanosecond)
		return "Through " + to.Format("Jan 2, 2006") + " by " + field + " date"
	}
	if query.To.IsZero() {
		return "From " + query.From.Format("Jan 2, 2006") + " by " + field + " date"
	}
	to := query.To.Add(-time.Nanosecond)
	return query.From.Format("Jan 2, 2006") + " to " + to.Format("Jan 2, 2006") + " by " + field + " date"
}

func isReportDoneStatus(status string) bool {
	value := normalizeClientTaskStatus(status)
	return value == "done" || value == "complete" || value == "completed" || value == "closed" || strings.Contains(value, "complete")
}

func minutesReportLabel(minutes int) string {
	if minutes <= 0 {
		return "0h"
	}
	hours := minutes / 60
	rest := minutes % 60
	if hours == 0 {
		return fmt.Sprintf("%dm", rest)
	}
	if rest == 0 {
		return fmt.Sprintf("%dh", hours)
	}
	return fmt.Sprintf("%dh %dm", hours, rest)
}

func userDisplayName(user models.User) string {
	if strings.TrimSpace(user.Name) != "" {
		return user.Name
	}
	if strings.TrimSpace(user.Username) != "" {
		return "@" + user.Username
	}
	return user.Email
}

func reportAssigneeNames(ids []primitive.ObjectID, users map[primitive.ObjectID]models.User) string {
	names := []string{}
	for _, id := range uniqueObjectIDs(ids) {
		if user, ok := users[id]; ok {
			names = append(names, userDisplayName(user))
		}
	}
	if len(names) == 0 {
		return "Unassigned"
	}
	return strings.Join(names, ", ")
}

func reportTaskChecklistItems(task models.ClientTask) []models.ChecklistItem {
	items := []models.ChecklistItem{}
	for _, block := range task.Blocks {
		for _, item := range block.Checklist {
			if strings.TrimSpace(item.Text) != "" {
				items = append(items, item)
			}
		}
	}
	if len(items) > 0 {
		return items
	}
	for _, item := range task.Checklist {
		if strings.TrimSpace(item.Text) != "" {
			items = append(items, item)
		}
	}
	return items
}

func reportChecklistStats(items []models.ChecklistItem) (done int, total int) {
	for _, item := range items {
		if strings.TrimSpace(item.Text) == "" {
			continue
		}
		total++
		if item.Done {
			done++
		}
	}
	return done, total
}

type simplePDF struct {
	title    string
	subtitle string
	pages    []*simplePDFPage
	current  *simplePDFPage
	y        float64
}

type simplePDFPage struct {
	content bytes.Buffer
}

func newSimplePDF(title string, subtitle string) *simplePDF {
	p := &simplePDF{title: title, subtitle: subtitle}
	p.addPage()
	return p
}

func (p *simplePDF) addPage() {
	page := &simplePDFPage{}
	p.pages = append(p.pages, page)
	p.current = page
	p.y = 744
	p.text(42, p.y, 18, p.title, "0.04 0.34 0.30")
	p.y -= 18
	p.text(42, p.y, 9, p.subtitle, "0.36 0.42 0.39")
	p.y -= 12
	p.line(42, p.y, 570, p.y)
	p.y -= 20
}

func (p *simplePDF) ensure(height float64) {
	if p.y-height < 52 {
		p.addPage()
	}
}

func (p *simplePDF) space(height float64) {
	p.ensure(height)
	p.y -= height
}

func (p *simplePDF) section(text string) {
	p.ensure(36)
	p.y -= 4
	p.text(42, p.y, 13, text, "0.04 0.34 0.30")
	p.y -= 14
	p.line(42, p.y, 570, p.y)
	p.y -= 10
}

func (p *simplePDF) kv(label string, value string) {
	p.ensure(16)
	p.text(46, p.y, 9, label+":", "0.36 0.42 0.39")
	p.text(156, p.y, 9, value, "0.08 0.12 0.10")
	p.y -= 13
}

func (p *simplePDF) small(text string) {
	lines := wrapText(text, 110, 9)
	p.ensure(float64(len(lines))*11 + 3)
	for _, line := range lines {
		p.text(46, p.y, 9, line, "0.36 0.42 0.39")
		p.y -= 11
	}
	p.y -= 3
}

func (p *simplePDF) paragraph(text string) {
	lines := wrapText(stripReportText(text), 96, 10)
	p.ensure(float64(len(lines))*13 + 6)
	for _, line := range lines {
		p.text(46, p.y, 10, line, "0.08 0.12 0.10")
		p.y -= 13
	}
	p.y -= 6
}

func (p *simplePDF) paragraphWithLineBreaks(text string) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	for _, rawLine := range strings.Split(text, "\n") {
		lineText := stripReportText(rawLine)
		if lineText == "" {
			p.ensure(8)
			p.y -= 8
			continue
		}
		lines := wrapText(lineText, 96, 10)
		for _, line := range lines {
			p.ensure(13)
			p.text(46, p.y, 10, line, "0.08 0.12 0.10")
			p.y -= 13
		}
	}
	p.y -= 6
}

func (p *simplePDF) reportNote(note string) {
	note = strings.TrimSpace(note)
	if note == "" {
		return
	}
	p.section("Report Note")
	p.paragraphWithLineBreaks(note)
}

func (p *simplePDF) taskRow(task models.ClientTask, users map[primitive.ObjectID]models.User, minutes int, options taskReportOptions) {
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = "Untitled task"
	}
	titleLines := wrapText(title+" ["+clientTaskStatusLogLabel(task.Status)+"]", 84, 10)
	contentLines := []string{}
	if options.Content {
		content := stripReportText(task.Content)
		if content == "" {
			content = stripReportText(task.Comment)
		}
		if len([]rune(content)) > 180 {
			content = strings.TrimSpace(string([]rune(content)[:180])) + "..."
		}
		contentLines = wrapText(content, 96, 8)
		if len(contentLines) > 2 {
			contentLines = contentLines[:2]
		}
	}
	checklistItems := []models.ChecklistItem{}
	if options.Checklist {
		checklistItems = reportTaskChecklistItems(task)
	}
	metaItems := []string{strings.ToUpper(task.Type), "Created " + task.CreatedAt.Format("2006-01-02")}
	if options.DueDates && task.DueDate != nil {
		metaItems = append(metaItems, "Due "+task.DueDate.Format("2006-01-02"))
	}
	if options.Time {
		metaItems = append(metaItems, "Time "+minutesReportLabel(minutes))
	}
	metaLines := wrapText(strings.Join(metaItems, "   "), 96, 7)
	height := float64(20 + len(metaLines)*9 + len(titleLines)*12 + len(contentLines)*10)
	if options.Assignees {
		height += 10
	}
	if options.Checklist && len(checklistItems) > 0 {
		height += 10
	}
	p.ensure(height)
	for _, line := range metaLines {
		p.text(46, p.y, 7, line, "0.36 0.42 0.39")
		p.y -= 9
	}
	for _, line := range titleLines {
		p.text(46, p.y, 10, line, "0.08 0.12 0.10")
		p.y -= 12
	}
	if options.Assignees {
		p.text(46, p.y, 8, "Assignees: "+reportAssigneeNames(task.AssigneeIDs, users), "0.36 0.42 0.39")
		p.y -= 10
	}
	for _, line := range contentLines {
		p.text(46, p.y, 8, line, "0.36 0.42 0.39")
		p.y -= 10
	}
	if len(checklistItems) > 0 {
		done, total := reportChecklistStats(checklistItems)
		p.ensure(12)
		p.text(46, p.y, 8, fmt.Sprintf("Checklist: %d/%d done", done, total), "0.04 0.34 0.30")
		p.y -= 10
		p.checklistItems(checklistItems)
	}
	if len(task.Annotations) > 0 {
		p.ensure(12)
		p.text(46, p.y, 8, fmt.Sprintf("Annotations: %d", len(task.Annotations)), "0.36 0.42 0.39")
		p.y -= 10
	}
	p.ensure(12)
	p.line(46, p.y, 566, p.y)
	p.y -= 10
}

func (p *simplePDF) checklistItems(items []models.ChecklistItem) {
	const (
		bottomY    = 52.0
		lineHeight = 9.0
		itemGap    = 2.0
		maxChars   = 46
	)
	columnX := [2]float64{54, 314}
	column := 0
	pageTop := p.y
	columnY := [2]float64{p.y, p.y}
	usedRightColumn := false

	advanceColumn := func() {
		if column == 0 {
			column = 1
			usedRightColumn = true
			columnY[1] = pageTop
			return
		}
		p.addPage()
		pageTop = p.y
		column = 0
		columnY = [2]float64{p.y, p.y}
		usedRightColumn = false
	}

	for _, item := range items {
		text := stripReportText(item.Text)
		if text == "" {
			continue
		}
		mark := "[ ]"
		if item.Done {
			mark = "[x]"
		}
		lines := wrapText(mark+" "+text, maxChars, 8)
		if len(lines) == 0 {
			continue
		}
		blockHeight := float64(len(lines))*lineHeight + itemGap
		columnCapacity := pageTop - bottomY
		if blockHeight <= columnCapacity && columnY[column]-blockHeight < bottomY {
			advanceColumn()
		}
		if blockHeight <= columnCapacity {
			for _, line := range lines {
				p.text(columnX[column], columnY[column], 8, line, "0.36 0.42 0.39")
				columnY[column] -= lineHeight
			}
			columnY[column] -= itemGap
			continue
		}
		for _, line := range lines {
			if columnY[column]-lineHeight < bottomY {
				advanceColumn()
			}
			p.text(columnX[column], columnY[column], 8, line, "0.36 0.42 0.39")
			columnY[column] -= lineHeight
		}
		if columnY[column]-itemGap < bottomY {
			advanceColumn()
		} else {
			columnY[column] -= itemGap
		}
	}

	if usedRightColumn {
		p.y = minFloat(columnY[0], columnY[1])
	} else {
		p.y = columnY[0]
	}
	p.y -= 4
}

func (p *simplePDF) completionRow(item taskReportCompletion, clients map[primitive.ObjectID]models.ClientProject, websites map[primitive.ObjectID]models.ClientWebsite, users map[primitive.ObjectID]models.User) {
	task := item.Task
	title := strings.TrimSpace(task.Title)
	if title == "" {
		title = "Untitled task"
	}
	actor := "Someone"
	if user, ok := users[item.Log.ActorID]; ok {
		actor = userDisplayName(user)
	}
	clientName := strings.TrimSpace(clients[task.ClientID].Name)
	websiteName := strings.TrimSpace(websites[task.WebsiteID].Name)
	if clientName == "" {
		clientName = "Unknown project"
	}
	if websiteName == "" {
		websiteName = "Unknown domain"
	}
	completedAt := "Unknown time"
	if !item.Log.CreatedAt.IsZero() {
		completedAt = item.Log.CreatedAt.Format("2006-01-02 15:04")
	}
	kind := "Marked complete"
	if item.Recurring {
		kind = "Recurring completion"
	}
	detail := strings.TrimSpace(item.Log.Detail)
	if detail == "" {
		detail = strings.ToLower(kind)
	}
	titleLines := wrapText(title, 82, 10)
	detailLines := wrapText(detail, 96, 8)
	if len(detailLines) > 2 {
		detailLines = detailLines[:2]
	}
	height := float64(38 + len(titleLines)*12 + len(detailLines)*10)
	p.ensure(height)
	p.text(46, p.y, 7, strings.ToUpper(kind), "0.04 0.34 0.30")
	p.text(176, p.y, 7, "Completed "+completedAt, "0.36 0.42 0.39")
	p.text(346, p.y, 7, "By "+actor, "0.36 0.42 0.39")
	p.y -= 12
	for _, line := range titleLines {
		p.text(46, p.y, 10, line, "0.08 0.12 0.10")
		p.y -= 12
	}
	p.text(46, p.y, 8, clientName+" / "+websiteName, "0.36 0.42 0.39")
	p.y -= 10
	p.text(46, p.y, 8, "Assignees: "+reportAssigneeNames(task.AssigneeIDs, users), "0.36 0.42 0.39")
	p.y -= 10
	for _, line := range detailLines {
		p.text(46, p.y, 8, line, "0.36 0.42 0.39")
		p.y -= 10
	}
	p.line(46, p.y, 566, p.y)
	p.y -= 10
}

func (p *simplePDF) text(x float64, y float64, size int, text string, color string) {
	safe := pdfSafeText(text)
	fmt.Fprintf(&p.current.content, "%s rg BT /F1 %d Tf %.2f %.2f Td (%s) Tj ET\n", color, size, x, y, escapePDFString(safe))
}

func (p *simplePDF) line(x1, y1, x2, y2 float64) {
	fmt.Fprintf(&p.current.content, "0.82 0.86 0.84 RG %.2f %.2f m %.2f %.2f l S\n", x1, y1, x2, y2)
}

func (p *simplePDF) bytes() []byte {
	var buf bytes.Buffer
	_, _ = buf.WriteString("%PDF-1.4\n")
	objectCount := 3 + len(p.pages)*2
	objects := make([]string, objectCount+1)
	kids := []string{}
	for i, page := range p.pages {
		contentID := 4 + i*2
		pageID := contentID + 1
		stream := page.content.String()
		objects[contentID] = fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream)
		objects[pageID] = fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", contentID)
		kids = append(kids, fmt.Sprintf("%d 0 R", pageID))
	}
	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
	objects[2] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(p.pages))
	objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
	offsets := make([]int, objectCount+1)
	for id := 1; id <= objectCount; id++ {
		offsets[id] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", id, objects[id])
	}
	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", objectCount+1)
	_, _ = buf.WriteString("0000000000 65535 f \n")
	for id := 1; id <= objectCount; id++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[id])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF", objectCount+1, xrefOffset)
	return buf.Bytes()
}

func wrapText(text string, maxChars int, size int) []string {
	_ = size
	text = stripReportText(text)
	if text == "" {
		return []string{}
	}
	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{text}
	}
	lines := []string{}
	current := ""
	for _, word := range words {
		for len([]rune(word)) > maxChars {
			prefix := string([]rune(word)[:maxChars])
			if current != "" {
				lines = append(lines, current)
				current = ""
			}
			lines = append(lines, prefix)
			word = string([]rune(word)[maxChars:])
		}
		if current == "" {
			current = word
			continue
		}
		if len([]rune(current))+1+len([]rune(word)) <= maxChars {
			current += " " + word
		} else {
			lines = append(lines, current)
			current = word
		}
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

func stripReportText(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	var b strings.Builder
	inTag := false
	for _, r := range value {
		switch r {
		case '<':
			inTag = true
			b.WriteRune(' ')
		case '>':
			inTag = false
		default:
			if !inTag {
				b.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func pdfSafeText(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r == '\n' || r == '\r' {
			b.WriteRune(' ')
			continue
		}
		if r < 32 {
			continue
		}
		if r > unicode.MaxASCII {
			b.WriteRune('?')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func escapePDFString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, "(", `\(`)
	value = strings.ReplaceAll(value, ")", `\)`)
	return value
}
