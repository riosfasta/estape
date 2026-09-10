package handlers

import (
	"context"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type marketplaceScopeRequest struct {
	TaskID string `json:"task_id"`
	Price  int64  `json:"price"`
}

func validateScopePricing(tasks []marketplaceScopeRequest, mode string, budget int64) error {
	if len(tasks) == 0 || len(tasks) > 500 {
		return marketInvalid("Select 1 to 500 tasks from one domain")
	}
	if mode != "domain" && mode != "per_task" {
		return marketInvalid("Choose a domain price or a price per task")
	}
	seen := map[string]bool{}
	total := int64(0)
	for _, task := range tasks {
		id, err := primitive.ObjectIDFromHex(task.TaskID)
		if err != nil || id.IsZero() || seen[id.Hex()] {
			return marketInvalid("Select each task once")
		}
		seen[id.Hex()] = true
		if mode == "per_task" {
			if task.Price < 100 || task.Price > maximumMarketplaceAmount {
				return marketInvalid("Each task price must be between $1 and $100,000")
			}
			total += task.Price
		} else if task.Price != 0 {
			return marketInvalid("Domain pricing uses one total, without individual task prices")
		}
	}
	if mode == "per_task" && total != budget {
		return marketInvalid("Task prices must add up to the job budget")
	}
	return nil
}

func (s *Server) prepareMarketplaceScope(ctx context.Context, user middleware.UserContext, job *models.MarketplaceJob, tasks []marketplaceScopeRequest, mode, websiteID string) error {
	if err := validateScopePricing(tasks, mode, job.Budget); err != nil {
		return err
	}
	for _, selected := range tasks {
		id, _ := primitive.ObjectIDFromHex(selected.TaskID)
		var task models.ClientTask
		if err := s.store.C("client_tasks").FindOne(ctx, bson.M{"_id": id}).Decode(&task); err != nil {
			return marketInvalid("A selected task is no longer available")
		}
		var website models.ClientWebsite
		if err := s.store.C("client_websites").FindOne(ctx, bson.M{"_id": task.WebsiteID}).Decode(&website); err != nil || !s.canAccessClientWebsite(ctx, user, website) || !s.canManageClientTask(ctx, user, task) {
			return marketInvalid("You cannot share one of these tasks")
		}
		if !job.ScopeWebsiteID.IsZero() && job.ScopeWebsiteID != task.WebsiteID {
			return marketInvalid("Select tasks from a single domain")
		}
		if websiteID != "" && websiteID != task.WebsiteID.Hex() {
			return marketInvalid("Task does not belong to the selected domain")
		}
		job.ScopeWebsiteID = task.WebsiteID
		content := task.Content
		if content == "" {
			for _, block := range task.Blocks {
				content += block.Content + "\n"
			}
		}
		if task.Comment != "" {
			content += "\n" + task.Comment
		}
		for _, item := range task.Checklist {
			content += "\n- " + item.Text
		}
		if len(content) > 20000 {
			return marketInvalid("A selected task description is too long to share")
		}
		job.ScopeTasks = append(job.ScopeTasks, models.MarketplaceScopeTask{TaskID: task.ID, Title: task.Title, Content: content, Status: task.Status, Price: selected.Price})
	}
	job.ScopePriceMode = mode
	if len(job.ScopeTasks) == 1 {
		job.SourceTaskID = job.ScopeTasks[0].TaskID
	}
	return nil
}

func scopedJobContains(job models.MarketplaceJob, taskID primitive.ObjectID) bool {
	for _, task := range job.ScopeTasks {
		if task.TaskID == taskID {
			return true
		}
	}
	return false
}

func scopedJobAccess(job models.MarketplaceJob, userID primitive.ObjectID, proposal *models.MarketplaceProposal) (bool, bool) {
	active := job.Status == "hired" || job.Status == "submitted"
	if userID == job.OwnerID {
		return true, active
	}
	if userID == job.FreelancerID && !userID.IsZero() {
		return active || job.Status == "completed", active
	}
	invited := proposal != nil && proposal.JobID == job.ID && proposal.FreelancerID == userID && proposal.Kind == "invitation" && (proposal.Status == "offered" || proposal.Status == "accepted")
	return job.Status == "open" && invited, false
}

func (s *Server) loadScopedJob(ctx context.Context, id, userID primitive.ObjectID) (models.MarketplaceJob, bool, error) {
	var job models.MarketplaceJob
	if err := s.store.C("marketplace_jobs").FindOne(ctx, bson.M{"_id": id}).Decode(&job); err != nil {
		return job, false, err
	}
	var proposal models.MarketplaceProposal
	_ = s.store.C("marketplace_proposals").FindOne(ctx, bson.M{"job_id": id, "freelancer_id": userID}).Decode(&proposal)
	read, write := scopedJobAccess(job, userID, &proposal)
	if !read {
		return job, false, marketInvalid("This task scope is private to the employer and invited freelancer")
	}
	return job, write, nil
}

// A scoped workspace never returns the website record, configuration, other tasks,
// attachments or company membership. Invitations show the offered snapshot only.
func (s *Server) marketplaceWork(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	job, write, err := s.loadScopedJob(c.Request.Context(), id, user.ID)
	if marketplaceError(c, err) {
		return
	}
	tasks := []gin.H{}
	for _, snapshot := range job.ScopeTasks {
		row := gin.H{"task_id": snapshot.TaskID, "title": snapshot.Title, "content": snapshot.Content, "status": snapshot.Status, "price": snapshot.Price, "statuses": []string{}, "comments": []gin.H{}}
		if write || (job.Status == "completed" && (user.ID == job.FreelancerID || user.ID == job.OwnerID)) {
			var task models.ClientTask
			if err := s.store.C("client_tasks").FindOne(c.Request.Context(), bson.M{"_id": snapshot.TaskID}).Decode(&task); err != nil {
				row["unavailable"] = true
				tasks = append(tasks, row)
				continue
			}
			row["status"] = task.Status
			var tab models.ClientTab
			statuses := defaultClientTaskStatuses()
			if s.store.C("client_tabs").FindOne(c.Request.Context(), bson.M{"_id": task.TabID}).Decode(&tab) == nil {
				statuses = normalizeClientTaskStatuses(tab.Statuses)
			}
			row["statuses"] = statuses
			// Only notes created within this contract are shared with its freelancer.
			cursor, err := s.store.C("marketplace_task_notes").Find(c.Request.Context(), bson.M{"job_id": id, "task_id": task.ID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(50))
			if err != nil {
				marketplaceError(c, err)
				return
			}
			notes := []bson.M{}
			err = cursor.All(c.Request.Context(), &notes)
			cursor.Close(c.Request.Context())
			if marketplaceError(c, err) {
				return
			}
			row["comments"] = notes
		}
		tasks = append(tasks, row)
	}
	team := []gin.H{}
	ids := []primitive.ObjectID{job.OwnerID}
	if job.Status == "hired" || job.Status == "submitted" || job.Status == "completed" {
		ids = append(ids, job.FreelancerID)
	}
	for _, memberID := range ids {
		if member, err := s.loadUser(c.Request.Context(), memberID); err == nil {
			team = append(team, gin.H{"id": member.ID, "name": member.Name, "username": member.Username, "role": map[bool]string{true: "employer", false: "freelancer"}[memberID == job.OwnerID]})
		}
	}
	c.JSON(200, gin.H{"tasks": tasks, "can_update": write, "team": team, "price_mode": job.ScopePriceMode, "budget": job.Budget, "agreed_price": job.Price, "hourly": hourlySummary(job, user.ID)})
}

func (s *Server) marketplaceUpdateWork(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	taskID, ok := objectIDParam(c, "taskId")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	var req struct {
		Status *string `json:"status"`
		Note   string  `json:"note"`
	}
	if c.ShouldBindJSON(&req) != nil || len(req.Note) > 5000 || (req.Status == nil && strings.TrimSpace(req.Note) == "") {
		marketplaceError(c, marketInvalid("Choose a status or write a work note up to 5000 characters"))
		return
	}
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		job, write, err := s.loadScopedJob(sc, id, user.ID)
		if err != nil {
			return err
		}
		if !write || !scopedJobContains(job, taskID) {
			return marketInvalid("You can only update tasks included in your active hire")
		}
		// Serialize against approval/cancellation so revoked access cannot write.
		if _, err := s.store.C("marketplace_jobs").UpdateByID(sc, id, bson.M{"$inc": bson.M{"work_revision": 1}}); err != nil {
			return err
		}
		var task models.ClientTask
		if err := s.store.C("client_tasks").FindOne(sc, bson.M{"_id": taskID}).Decode(&task); err != nil {
			return err
		}
		now := time.Now().UTC()
		set := bson.M{"updated_at": now}
		if req.Status != nil {
			var tab models.ClientTab
			statuses := defaultClientTaskStatuses()
			if s.store.C("client_tabs").FindOne(sc, bson.M{"_id": task.TabID}).Decode(&tab) == nil {
				statuses = normalizeClientTaskStatuses(tab.Statuses)
			}
			status := normalizeClientTaskStatus(*req.Status)
			if !containsString(statuses, status) {
				return marketInvalid("Choose a status from this task board")
			}
			set["status"] = status
			if clientTaskIsRecurring(task) && clientTaskIsDoneStatus(status) {
				set["status"] = clientTaskResetStatus(statuses)
				set["completion_count"] = task.CompletionCount + 1
				set["last_completed_at"] = now
				if next := nextClientTaskRecurringDueDate(task.DueDate, task.Recurrence, now); next != nil {
					set["due_date"] = next
				}
			}
		}
		if _, err := s.store.C("client_tasks").UpdateByID(sc, taskID, bson.M{"$set": set}); err != nil {
			return err
		}
		note := strings.TrimSpace(req.Note)
		if note != "" {
			if _, err := s.store.C("marketplace_task_notes").InsertOne(sc, bson.M{"_id": primitive.NewObjectID(), "job_id": id, "task_id": taskID, "sender_id": user.ID, "content": note, "created_at": now}); err != nil {
				return err
			}
		}
		target := job.OwnerID
		if user.ID == target {
			target = job.FreelancerID
		}
		return s.marketplaceNotify(sc, target, id, "marketplace_job", "Task update: "+task.Title)
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

func chatPairAllowed(job models.MarketplaceJob, proposal models.MarketplaceProposal, userID, freelancerID primitive.ObjectID) bool {
	return !freelancerID.IsZero() && freelancerID != job.OwnerID && proposal.JobID == job.ID && proposal.FreelancerID == freelancerID && (userID == job.OwnerID || userID == freelancerID)
}

func (s *Server) marketplaceJobChat(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	freelancerID, ok := objectIDParam(c, "freelancerId")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var job models.MarketplaceJob
	var proposal models.MarketplaceProposal
	if s.store.C("marketplace_jobs").FindOne(ctx, bson.M{"_id": id}).Decode(&job) != nil || s.store.C("marketplace_proposals").FindOne(ctx, bson.M{"job_id": id, "freelancer_id": freelancerID}).Decode(&proposal) != nil || !chatPairAllowed(job, proposal, user.ID, freelancerID) {
		c.JSON(403, gin.H{"error": "This invitation chat is private"})
		return
	}
	if c.Request.Method == "POST" {
		var req struct {
			Content   string             `json:"content"`
			RequestID primitive.ObjectID `json:"request_id"`
		}
		if c.ShouldBindJSON(&req) != nil || req.RequestID.IsZero() || len(strings.TrimSpace(req.Content)) == 0 || len(req.Content) > 5000 {
			marketplaceError(c, marketInvalid("Write a message up to 5000 characters"))
			return
		}
		if job.Status == "cancelled" || proposal.Status == "not_selected" || proposal.Status == "cancelled" || proposal.Status == "declined" {
			marketplaceError(c, marketInvalid("This invitation is closed; its chat is read-only"))
			return
		}
		message := models.MarketplaceChatMessage{ID: req.RequestID, JobID: id, FreelancerID: freelancerID, SenderID: user.ID, Content: strings.TrimSpace(req.Content), CreatedAt: time.Now().UTC()}
		err := s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
			if err := s.store.C("marketplace_jobs").FindOne(sc, bson.M{"_id": id}).Decode(&job); err != nil {
				return err
			}
			if err := s.store.C("marketplace_proposals").FindOne(sc, bson.M{"job_id": id, "freelancer_id": freelancerID}).Decode(&proposal); err != nil {
				return err
			}
			if !chatPairAllowed(job, proposal, user.ID, freelancerID) || job.Status == "cancelled" || proposal.Status == "not_selected" || proposal.Status == "cancelled" || proposal.Status == "declined" {
				return marketInvalid("This invitation chat is read-only")
			}
			if _, err := s.store.C("marketplace_jobs").UpdateByID(sc, id, bson.M{"$inc": bson.M{"work_revision": 1}}); err != nil {
				return err
			}
			// Require this exact pair even when an idempotency ID is reused.
			result, err := s.store.C("marketplace_chat").UpdateOne(sc, bson.M{"_id": req.RequestID, "job_id": id, "freelancer_id": freelancerID, "sender_id": user.ID}, bson.M{"$setOnInsert": message}, options.Update().SetUpsert(true))
			if err != nil {
				return err
			}
			if result.UpsertedCount == 0 {
				return nil
			}
			target := job.OwnerID
			if user.ID == target {
				target = freelancerID
			}
			return s.marketplaceNotify(sc, target, id, "marketplace_job", "New invitation message: "+job.Title)
		})
		if !marketplaceError(c, err) {
			c.JSON(200, gin.H{"ok": true})
		}
		return
	}
	cursor, err := s.store.C("marketplace_chat").Find(ctx, bson.M{"job_id": id, "freelancer_id": freelancerID}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(100))
	if marketplaceError(c, err) {
		return
	}
	defer cursor.Close(ctx)
	messages := []models.MarketplaceChatMessage{}
	if marketplaceError(c, cursor.All(ctx, &messages)) {
		return
	}
	c.JSON(200, gin.H{"messages": messages, "read_only": job.Status == "cancelled" || proposal.Status == "not_selected" || proposal.Status == "cancelled" || proposal.Status == "declined"})
}

func (s *Server) scopedTaskFreelancers(ctx context.Context, taskID primitive.ObjectID) []gin.H {
	cursor, err := s.store.C("marketplace_jobs").Find(ctx, bson.M{"scope_tasks.task_id": taskID, "status": bson.M{"$in": []string{"hired", "submitted"}}}, options.Find().SetLimit(100))
	if err != nil {
		return []gin.H{}
	}
	defer cursor.Close(ctx)
	rows := []gin.H{}
	for cursor.Next(ctx) {
		var job models.MarketplaceJob
		if cursor.Decode(&job) != nil {
			continue
		}
		member, err := s.loadUser(ctx, job.FreelancerID)
		if err != nil || member.Status == models.StatusSuspended {
			continue
		}
		safe := models.User{ID: member.ID, Name: member.Name, Username: member.Username, AvatarURL: member.AvatarURL}
		rows = append(rows, gin.H{"user": safe, "client_role": "freelancer", "job_id": job.ID})
	}
	return rows
}

func (s *Server) marketplaceTaskTeam(c *gin.Context) {
	task, ok := s.loadClientTaskForAccess(c, false)
	if !ok {
		return
	}
	rows, _ := s.clientTaskPermittedMemberRows(c.Request.Context(), task)
	users := []gin.H{}
	seen := map[primitive.ObjectID]bool{}
	for _, row := range rows {
		member, ok := row["user"].(models.User)
		if ok && !seen[member.ID] && member.Status == models.StatusActive {
			seen[member.ID] = true
			users = append(users, gin.H{
				"id":         member.ID,
				"name":       member.Name,
				"username":   member.Username,
				"email":      member.Email,
				"avatar_url": member.AvatarURL,
				"staff_role": member.StaffRole,
				"role":       member.Role,
			})
		}
	}
	c.JSON(200, gin.H{"users": users})
}
