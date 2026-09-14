package handlers

import (
	"math"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// adminConflictsOverview returns platform-wide conflict audit data for the platform owner
func (s *Server) adminConflictsOverview(c *gin.Context) {
	ctx := c.Request.Context()

	// Load all User Admins (RoleTeamAdmin)
	adminCursor, err := s.store.C("users").Find(ctx, bson.M{
		"role":   models.RoleTeamAdmin,
		"status": models.StatusActive,
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load user admins"})
		return
	}
	defer adminCursor.Close(ctx)
	var admins []models.User
	_ = adminCursor.All(ctx, &admins)
	if admins == nil {
		admins = []models.User{}
	}

	// Load all Freelancers (RoleMember or users assigned to tasks)
	memberCursor, err := s.store.C("users").Find(ctx, bson.M{
		"role":   models.RoleMember,
		"status": models.StatusActive,
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load freelancers"})
		return
	}
	defer memberCursor.Close(ctx)
	var members []models.User
	_ = memberCursor.All(ctx, &members)
	if members == nil {
		members = []models.User{}
	}

	// Load teams to map company names
	teamsCursor, _ := s.store.C("teams").Find(ctx, bson.M{})
	teamsByID := make(map[primitive.ObjectID]models.Team)
	if teamsCursor != nil {
		var teams []models.Team
		_ = teamsCursor.All(ctx, &teams)
		for _, tm := range teams {
			teamsByID[tm.ID] = tm
		}
		teamsCursor.Close(ctx)
	}

	// Load all client projects
	projectsCursor, _ := s.store.C("client_projects").Find(ctx, bson.M{})
	projectsByID := make(map[primitive.ObjectID]models.ClientProject)
	if projectsCursor != nil {
		var projects []models.ClientProject
		_ = projectsCursor.All(ctx, &projects)
		for _, p := range projects {
			projectsByID[p.ID] = p
		}
		projectsCursor.Close(ctx)
	}

	// Load all client tasks
	tasksCursor, _ := s.store.C("client_tasks").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(1000))
	var allTasks []models.ClientTask
	if tasksCursor != nil {
		_ = tasksCursor.All(ctx, &allTasks)
		tasksCursor.Close(ctx)
	}

	// Load all time entries
	timeCursor, _ := s.store.C("time_entries").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "start_time", Value: -1}}).SetLimit(2000))
	var allEntries []models.TimeEntry
	if timeCursor != nil {
		_ = timeCursor.All(ctx, &allEntries)
		timeCursor.Close(ctx)
	}

	// Aggregate task metrics per task ID
	type taskMetrics struct {
		totalMinutes int
		totalAmount  float64
		unpaidAmount float64
		paidAmount   float64
	}
	taskMetricsMap := make(map[primitive.ObjectID]*taskMetrics)
	userHourlyRates := make(map[primitive.ObjectID]float64)
	for _, m := range members {
		userHourlyRates[m.ID] = m.HourlyRate
	}

	for _, e := range allEntries {
		if e.TaskID.IsZero() {
			continue
		}
		tm, ok := taskMetricsMap[e.TaskID]
		if !ok {
			tm = &taskMetrics{}
			taskMetricsMap[e.TaskID] = tm
		}
		rate := e.HourlyRate
		if rate == 0 {
			rate = userHourlyRates[e.UserID]
		}
		hrs := float64(e.DurationMinutes) / 60.0
		amt := math.Round(hrs*rate*100) / 100.0
		tm.totalMinutes += e.DurationMinutes
		tm.totalAmount += amt
		if e.Paid {
			tm.paidAmount += amt
		} else {
			tm.unpaidAmount += amt
		}
	}

	totalPlatformPayroll := 0.0
	totalPlatformUnpaid := 0.0
	totalPlatformPaid := 0.0

	// Aggregate admin stats
	adminStatsMap := make(map[primitive.ObjectID]gin.H)
	for _, a := range admins {
		tmName := "Company Workspace"
		if tm, exists := teamsByID[a.TeamID]; exists && tm.Name != "" {
			tmName = tm.Name
		}
		adminStatsMap[a.ID] = gin.H{
			"id":             a.ID.Hex(),
			"name":           firstNonEmpty(a.Name, a.Username, a.Email),
			"email":          a.Email,
			"username":       a.Username,
			"avatar_url":     a.AvatarURL,
			"company_name":   tmName,
			"team_id":        a.TeamID.Hex(),
			"project_count":  0,
			"task_count":     0,
			"total_amount":   0.0,
			"unpaid_amount":  0.0,
			"paid_amount":    0.0,
			"ratings_given":  0,
			"disputed_count": 0,
		}
	}

	// Count projects per admin/team
	for _, p := range projectsByID {
		for aID, aStats := range adminStatsMap {
			adminTeamID := primitive.NilObjectID
			if tHex, ok := aStats["team_id"].(string); ok {
				adminTeamID, _ = primitive.ObjectIDFromHex(tHex)
			}
			if p.CreatedBy == aID || (!adminTeamID.IsZero() && p.TeamID == adminTeamID) {
				count, _ := aStats["project_count"].(int)
				aStats["project_count"] = count + 1
			}
		}
	}

	// Aggregate freelancer stats
	freelancerStatsMap := make(map[primitive.ObjectID]gin.H)
	for _, m := range members {
		freelancerStatsMap[m.ID] = gin.H{
			"id":              m.ID.Hex(),
			"name":            firstNonEmpty(m.Name, m.Username, m.Email),
			"email":           m.Email,
			"username":        m.Username,
			"avatar_url":      m.AvatarURL,
			"hourly_rate":     m.HourlyRate,
			"task_count":      0,
			"completed_count": 0,
			"total_hours":     0.0,
			"total_amount":    0.0,
			"unpaid_amount":   0.0,
			"paid_amount":     0.0,
			"ratings_count":   0,
			"avg_rating":      0.0,
			"disputed_count":  0,
		}
	}

	// Disputed / Flagged tasks list
	var disputedTasks []gin.H

	for _, t := range allTasks {
		metrics := taskMetricsMap[t.ID]
		taskAmt := 0.0
		taskUnpaid := 0.0
		taskPaid := 0.0
		taskHours := 0.0
		isPaid := strings.EqualFold(t.PaymentStatus, "paid")
		if metrics != nil {
			taskAmt = metrics.totalAmount
			taskUnpaid = metrics.unpaidAmount
			taskPaid = metrics.paidAmount
			taskHours = math.Round(float64(metrics.totalMinutes)/60.0*100) / 100.0
		} else if t.Price > 0 {
			taskAmt = t.Price
			if isPaid {
				taskPaid = t.Price
			} else {
				taskUnpaid = t.Price
			}
		}

		totalPlatformPayroll += taskAmt
		totalPlatformUnpaid += taskUnpaid
		totalPlatformPaid += taskPaid

		// Determine admin owner
		var taskAdminID primitive.ObjectID
		if proj, ok := projectsByID[t.ClientID]; ok {
			taskAdminID = proj.CreatedBy
			if taskAdminID.IsZero() {
				for aID, aStats := range adminStatsMap {
					adminTeamID, _ := primitive.ObjectIDFromHex(aStats["team_id"].(string))
					if !adminTeamID.IsZero() && adminTeamID == proj.TeamID {
						taskAdminID = aID
						break
					}
				}
			}
		}
		if taskAdminID.IsZero() && !t.CreatedBy.IsZero() {
			taskAdminID = t.CreatedBy
		}

		if aStats, exists := adminStatsMap[taskAdminID]; exists {
			tc, _ := aStats["task_count"].(int)
			aStats["task_count"] = tc + 1
			aTot, _ := aStats["total_amount"].(float64)
			aStats["total_amount"] = math.Round((aTot+taskAmt)*100) / 100.0
			aUnp, _ := aStats["unpaid_amount"].(float64)
			aStats["unpaid_amount"] = math.Round((aUnp+taskUnpaid)*100) / 100.0
			aPd, _ := aStats["paid_amount"].(float64)
			aStats["paid_amount"] = math.Round((aPd+taskPaid)*100) / 100.0
		}

		// Update assignees stats
		for _, assigneeID := range t.AssigneeIDs {
			if fStats, exists := freelancerStatsMap[assigneeID]; exists {
				tc, _ := fStats["task_count"].(int)
				fStats["task_count"] = tc + 1
				statusLower := strings.ToLower(t.Status)
				if statusLower == "done" || statusLower == "completed" {
					cc, _ := fStats["completed_count"].(int)
					fStats["completed_count"] = cc + 1
				}
				th, _ := fStats["total_hours"].(float64)
				fStats["total_hours"] = math.Round((th+taskHours)*100) / 100.0
				fTot, _ := fStats["total_amount"].(float64)
				fStats["total_amount"] = math.Round((fTot+taskAmt)*100) / 100.0
				fUnp, _ := fStats["unpaid_amount"].(float64)
				fStats["unpaid_amount"] = math.Round((fUnp+taskUnpaid)*100) / 100.0
				fPd, _ := fStats["paid_amount"].(float64)
				fStats["paid_amount"] = math.Round((fPd+taskPaid)*100) / 100.0
			}
		}

		// Check for conflict triggers:
		// 1. Task completed but has unpaid balance > 0
		// 2. Any rating <= 2 stars
		// 3. Significant rating discrepancy
		isCompleted := strings.EqualFold(t.Status, "done") || strings.EqualFold(t.Status, "completed")
		hasUnpaidCompleted := isCompleted && (taskUnpaid > 0 || (!isPaid && taskAmt > 0))
		hasLowRating := false
		var adminRating *models.TaskRating
		var freelancerRating *models.TaskRating

		for i := range t.Ratings {
			r := &t.Ratings[i]
			if r.Role == "admin" || r.Role == "users_admin" || r.Role == "owner_adm" {
				adminRating = r
			} else {
				freelancerRating = r
			}
			if r.Rating <= 2 {
				hasLowRating = true
			}
		}

		ratingDispute := false
		if adminRating != nil && freelancerRating != nil {
			if math.Abs(float64(adminRating.Rating-freelancerRating.Rating)) >= 2 {
				ratingDispute = true
			}
		}

		if hasUnpaidCompleted || hasLowRating || ratingDispute {
			// Flag as conflict
			reason := "Completed deliverable with unpaid balance"
			if hasLowRating {
				reason = "Low rating (negative review recorded)"
			} else if ratingDispute {
				reason = "Rating dispute between admin and freelancer"
			}

			adminName := "Admin"
			if aStats, exists := adminStatsMap[taskAdminID]; exists {
				adminName = aStats["name"].(string)
				dc, _ := aStats["disputed_count"].(int)
				aStats["disputed_count"] = dc + 1
			}

			var freelancerNames []string
			for _, aid := range t.AssigneeIDs {
				if fStats, exists := freelancerStatsMap[aid]; exists {
					freelancerNames = append(freelancerNames, fStats["name"].(string))
					dc, _ := fStats["disputed_count"].(int)
					fStats["disputed_count"] = dc + 1
				}
			}

			projectName := ""
			if proj, ok := projectsByID[t.ClientID]; ok {
				projectName = proj.Name
			}

			disputedTasks = append(disputedTasks, gin.H{
				"task_id":            t.ID.Hex(),
				"title":              t.Title,
				"project_id":         t.ClientID.Hex(),
				"project_name":       projectName,
				"admin_id":           taskAdminID.Hex(),
				"admin_name":         adminName,
				"freelancer_ids":     uniqueHexIDs(t.AssigneeIDs),
				"freelancer_names":   freelancerNames,
				"status":             t.Status,
				"price":              taskAmt,
				"unpaid_amount":      taskUnpaid,
				"paid_amount":        taskPaid,
				"hours":              taskHours,
				"is_paid":            isPaid,
				"admin_rating":       adminRating,
				"freelancer_rating":  freelancerRating,
				"conflict_reason":    reason,
				"created_at":         t.CreatedAt,
				"updated_at":         t.UpdatedAt,
			})
		}
	}

	var adminList []gin.H
	for _, a := range admins {
		if stats, ok := adminStatsMap[a.ID]; ok {
			adminList = append(adminList, stats)
		}
	}

	var freelancerList []gin.H
	for _, m := range members {
		if stats, ok := freelancerStatsMap[m.ID]; ok {
			freelancerList = append(freelancerList, stats)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"kpis": gin.H{
			"total_admins":         len(admins),
			"total_freelancers":    len(members),
			"total_tasks":          len(allTasks),
			"disputed_tasks_count": len(disputedTasks),
			"total_payroll":        math.Round(totalPlatformPayroll*100) / 100.0,
			"unpaid_payroll":       math.Round(totalPlatformUnpaid*100) / 100.0,
			"paid_payroll":         math.Round(totalPlatformPaid*100) / 100.0,
		},
		"admins":         adminList,
		"freelancers":    freelancerList,
		"disputed_tasks": disputedTasks,
	})
}

// adminConflictsAudit returns a cross-audit inspection between a specific admin and/or freelancer
func (s *Server) adminConflictsAudit(c *gin.Context) {
	ctx := c.Request.Context()
	adminIDRaw := strings.TrimSpace(c.Query("admin_id"))
	freelancerIDRaw := strings.TrimSpace(c.Query("freelancer_id"))

	var adminID primitive.ObjectID
	var freelancerID primitive.ObjectID
	var adminUser *models.User
	var freelancerUser *models.User

	if adminIDRaw != "" {
		if id, err := primitive.ObjectIDFromHex(adminIDRaw); err == nil {
			adminID = id
			var u models.User
			if err := s.store.C("users").FindOne(ctx, bson.M{"_id": adminID}).Decode(&u); err == nil {
				adminUser = &u
			}
		}
	}

	if freelancerIDRaw != "" {
		if id, err := primitive.ObjectIDFromHex(freelancerIDRaw); err == nil {
			freelancerID = id
			var u models.User
			if err := s.store.C("users").FindOne(ctx, bson.M{"_id": freelancerID}).Decode(&u); err == nil {
				freelancerUser = &u
			}
		}
	}

	// Find all projects for admin
	var clientProjects []models.ClientProject
	var projectIDs []primitive.ObjectID
	if adminUser != nil {
		pFilter := bson.M{"$or": []bson.M{
			{"created_by": adminUser.ID},
			{"team_id": adminUser.TeamID},
		}}
		if cursor, err := s.store.C("client_projects").Find(ctx, pFilter); err == nil {
			_ = cursor.All(ctx, &clientProjects)
			cursor.Close(ctx)
			for _, p := range clientProjects {
				projectIDs = append(projectIDs, p.ID)
			}
		}
	}

	// Find tasks matching both ends
	taskFilter := bson.M{}
	andConditions := []bson.M{}

	if len(projectIDs) > 0 || adminUser != nil {
		orAdmin := []bson.M{}
		if len(projectIDs) > 0 {
			orAdmin = append(orAdmin, bson.M{"client_id": bson.M{"$in": projectIDs}})
		}
		if adminUser != nil {
			orAdmin = append(orAdmin, bson.M{"created_by": adminUser.ID})
			if !adminUser.TeamID.IsZero() {
				orAdmin = append(orAdmin, bson.M{"team_id": adminUser.TeamID})
			}
		}
		andConditions = append(andConditions, bson.M{"$or": orAdmin})
	}

	if !freelancerID.IsZero() {
		andConditions = append(andConditions, bson.M{"$or": []bson.M{
			{"assignee_ids": freelancerID},
			{"annotations.assignee_ids": freelancerID},
		}})
	}

	if len(andConditions) > 0 {
		taskFilter = bson.M{"$and": andConditions}
	}

	var tasks []models.ClientTask
	if cursor, err := s.store.C("client_tasks").Find(ctx, taskFilter, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}})); err == nil {
		_ = cursor.All(ctx, &tasks)
		cursor.Close(ctx)
	}

	taskIDs := make([]primitive.ObjectID, 0, len(tasks))
	for _, t := range tasks {
		taskIDs = append(taskIDs, t.ID)
	}

	// Find time entries
	timeFilter := bson.M{}
	timeAnd := []bson.M{}
	if len(taskIDs) > 0 {
		timeAnd = append(timeAnd, bson.M{"task_id": bson.M{"$in": taskIDs}})
	}
	if !freelancerID.IsZero() {
		timeAnd = append(timeAnd, bson.M{"user_id": freelancerID})
	}
	if len(timeAnd) > 0 {
		timeFilter = bson.M{"$and": timeAnd}
	}

	var timeEntries []models.TimeEntry
	if cursor, err := s.store.C("time_entries").Find(ctx, timeFilter, options.Find().SetSort(bson.D{{Key: "start_time", Value: -1}})); err == nil {
		_ = cursor.All(ctx, &timeEntries)
		cursor.Close(ctx)
	}

	// Calculate cross-metrics
	totalMinutes := 0
	totalAmount := 0.0
	unpaidAmount := 0.0
	paidAmount := 0.0

	freelancerRate := 0.0
	if freelancerUser != nil {
		freelancerRate = freelancerUser.HourlyRate
	}

	timeByTask := make(map[primitive.ObjectID]*struct {
		minutes int
		amount  float64
		unpaid  float64
		paid    float64
	})

	for _, e := range timeEntries {
		rate := e.HourlyRate
		if rate == 0 {
			rate = freelancerRate
		}
		hrs := float64(e.DurationMinutes) / 60.0
		amt := math.Round(hrs*rate*100) / 100.0

		totalMinutes += e.DurationMinutes
		totalAmount += amt
		if e.Paid {
			paidAmount += amt
		} else {
			unpaidAmount += amt
		}

		tt, ok := timeByTask[e.TaskID]
		if !ok {
			tt = &struct {
				minutes int
				amount  float64
				unpaid  float64
				paid    float64
			}{}
			timeByTask[e.TaskID] = tt
		}
		tt.minutes += e.DurationMinutes
		tt.amount += amt
		if e.Paid {
			tt.paid += amt
		} else {
			tt.unpaid += amt
		}
	}

	// Project names mapping
	projectNames := make(map[primitive.ObjectID]string)
	for _, p := range clientProjects {
		projectNames[p.ID] = p.Name
	}

	var sharedDeliverables []gin.H
	for _, t := range tasks {
		tt := timeByTask[t.ID]
		taskHours := 0.0
		taskAmt := 0.0
		taskUnpaid := 0.0
		taskPaid := 0.0
		isPaid := strings.EqualFold(t.PaymentStatus, "paid")

		if tt != nil {
			taskHours = math.Round((float64(tt.minutes)/60.0)*100) / 100.0
			taskAmt = tt.amount
			taskUnpaid = tt.unpaid
			taskPaid = tt.paid
		} else if t.Price > 0 {
			taskAmt = t.Price
			if isPaid {
				taskPaid = t.Price
			} else {
				taskUnpaid = t.Price
			}
		}

		var adminRating *models.TaskRating
		var freelancerRating *models.TaskRating
		for i := range t.Ratings {
			r := &t.Ratings[i]
			if r.Role == "admin" || r.Role == "users_admin" || r.Role == "owner_adm" {
				adminRating = r
			} else {
				freelancerRating = r
			}
		}

		sharedDeliverables = append(sharedDeliverables, gin.H{
			"task_id":           t.ID.Hex(),
			"title":             t.Title,
			"project_name":      projectNames[t.ClientID],
			"status":            t.Status,
			"hourly_rate":       t.HourlyRate,
			"fixed_price":       t.Price,
			"pricing_type":      t.BillingType,
			"tracked_hours":     taskHours,
			"total_amount":      taskAmt,
			"unpaid_amount":     taskUnpaid,
			"paid_amount":       taskPaid,
			"is_paid":           isPaid,
			"admin_rating":      adminRating,
			"freelancer_rating": freelancerRating,
			"created_at":        t.CreatedAt,
			"updated_at":        t.UpdatedAt,
		})
	}

	// Prepare user response views
	var adminView gin.H
	if adminUser != nil {
		adminView = gin.H{
			"id":         adminUser.ID.Hex(),
			"name":       firstNonEmpty(adminUser.Name, adminUser.Username, adminUser.Email),
			"email":      adminUser.Email,
			"username":   adminUser.Username,
			"role":       adminUser.Role,
			"avatar_url": adminUser.AvatarURL,
			"team_id":    adminUser.TeamID.Hex(),
		}
	}

	var freelancerView gin.H
	if freelancerUser != nil {
		freelancerView = gin.H{
			"id":          freelancerUser.ID.Hex(),
			"name":        firstNonEmpty(freelancerUser.Name, freelancerUser.Username, freelancerUser.Email),
			"email":       freelancerUser.Email,
			"username":    freelancerUser.Username,
			"role":        freelancerUser.Role,
			"avatar_url":  freelancerUser.AvatarURL,
			"hourly_rate": freelancerUser.HourlyRate,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"admin":       adminView,
		"freelancer":  freelancerView,
		"tasks":       sharedDeliverables,
		"task_count":  len(sharedDeliverables),
		"entry_count": len(timeEntries),
		"summary": gin.H{
			"total_hours":   math.Round((float64(totalMinutes)/60.0)*100) / 100.0,
			"total_amount":  math.Round(totalAmount*100) / 100.0,
			"unpaid_amount": math.Round(unpaidAmount*100) / 100.0,
			"paid_amount":   math.Round(paidAmount*100) / 100.0,
		},
	})
}

// adminConflictsResolve allows platform owner to resolve disputes, mark work paid, or record resolution note
func (s *Server) adminConflictsResolve(c *gin.Context) {
	ctx := c.Request.Context()
	userCtx, _ := currentUser(c)

	var req struct {
		TaskID         string `json:"task_id"`
		UserID         string `json:"user_id"`
		Action         string `json:"action"`          // "mark_paid", "settle_all", "add_note"
		ResolutionNote string `json:"resolution_note"` // owner explanation / verdict
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	now := time.Now()

	// If task_id provided, update task and its time entries
	if req.TaskID != "" {
		taskOID, err := primitive.ObjectIDFromHex(req.TaskID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task_id"})
			return
		}

		var task models.ClientTask
		if err := s.store.C("client_tasks").FindOne(ctx, bson.M{"_id": taskOID}).Decode(&task); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
			return
		}

		updateFields := bson.M{
			"payment_status": "paid",
			"updated_at":     now,
		}
		if req.ResolutionNote != "" {
			updateFields["resolution_note"] = req.ResolutionNote
			updateFields["resolution_by"] = userCtx.ID
			updateFields["resolution_at"] = now
		}

		_, _ = s.store.C("client_tasks").UpdateByID(ctx, taskOID, bson.M{"$set": updateFields})
		_, _ = s.store.C("time_entries").UpdateMany(ctx, bson.M{"task_id": taskOID}, bson.M{"$set": bson.M{
			"paid":    true,
			"paid_at": now,
		}})

		// Record audit log
		s.recordClientTaskLog(ctx, task, userCtx.ID, "conflict_resolved", firstNonEmpty(req.ResolutionNote, "Platform owner settled task payment and resolved conflict"))
	}

	// If user_id provided for settling all unpaid time entries
	if req.UserID != "" && req.Action == "settle_all" {
		uid, err := primitive.ObjectIDFromHex(req.UserID)
		if err == nil {
			_, _ = s.store.C("time_entries").UpdateMany(ctx, bson.M{"user_id": uid, "paid": bson.M{"$ne": true}}, bson.M{"$set": bson.M{
				"paid":    true,
				"paid_at": now,
			}})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Conflict status and settlement updated successfully",
	})
}

func uniqueHexIDs(ids []primitive.ObjectID) []string {
	seen := make(map[string]bool)
	var out []string
	for _, id := range ids {
		hex := id.Hex()
		if !seen[hex] {
			seen[hex] = true
			out = append(out, hex)
		}
	}
	return out
}
