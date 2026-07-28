package handlers

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type teamPerformanceMember struct {
	ID              primitive.ObjectID `json:"id"`
	Name            string             `json:"name"`
	Username        string             `json:"username,omitempty"`
	Email           string             `json:"email,omitempty"`
	AvatarURL       string             `json:"avatar_url,omitempty"`
	Role            models.Role        `json:"role"`
	StaffRole       string             `json:"staff_role,omitempty"`
	AssignedTasks   int                `json:"assigned_tasks"`
	CreatedTasks    int                `json:"created_tasks"`
	CompletedTasks  int                `json:"completed_tasks"`
	OpenTasks       int                `json:"open_tasks"`
	OverdueTasks    int                `json:"overdue_tasks"`
	AnnotationTasks int                `json:"annotation_tasks"`
	Comments        int                `json:"comments"`
	TimeMinutes     int                `json:"time_minutes"`
	Score           int                `json:"score"`
}

func (s *Server) teamPerformance(c *gin.Context) {
	userCtx, _ := currentUser(c)
	user, err := s.loadUser(c.Request.Context(), userCtx.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	userCtx.Role = user.Role
	userCtx.TeamID = user.TeamID

	period := normalizePerformancePeriod(c.DefaultQuery("period", "weekly"))
	now := time.Now()
	from := performancePeriodStart(now, period)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	clients, err := s.performanceClientProjects(c, userCtx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load client projects"})
		return
	}

	clientIDs := make([]primitive.ObjectID, 0, len(clients))
	teamIDs := []primitive.ObjectID{}
	memberIDs := []primitive.ObjectID{user.ID}
	for _, client := range clients {
		clientIDs = append(clientIDs, client.ID)
		teamIDs = append(teamIDs, client.TeamID)
		memberIDs = append(memberIDs, client.CreatedBy)
		memberIDs = append(memberIDs, client.MemberIDs...)
		memberIDs = append(memberIDs, client.ClientAdminIDs...)
	}

	userMap := map[primitive.ObjectID]models.User{}
	addUser := func(item models.User) {
		if item.ID.IsZero() {
			return
		}
		userMap[item.ID] = item
	}
	addUser(user)

	for _, item := range s.performanceWorkspaceUsers(c, userCtx, uniqueObjectIDs(memberIDs)) {
		addUser(item)
	}

	tasks := []models.ClientTask{}
	taskIDs := []primitive.ObjectID{}
	if len(clientIDs) > 0 {
		cursor, err := s.store.C("client_tasks").Find(c.Request.Context(), bson.M{"client_id": bson.M{"$in": clientIDs}}, options.Find().SetLimit(10000))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load tasks"})
			return
		}
		defer cursor.Close(c.Request.Context())
		for cursor.Next(c.Request.Context()) {
			var task models.ClientTask
			if cursor.Decode(&task) != nil {
				continue
			}
			tasks = append(tasks, task)
			taskIDs = append(taskIDs, task.ID)
			memberIDs = append(memberIDs, task.CreatedBy)
			memberIDs = append(memberIDs, task.AssigneeIDs...)
			for _, annotation := range task.Annotations {
				memberIDs = append(memberIDs, annotation.CreatedBy)
				memberIDs = append(memberIDs, annotation.AssigneeIDs...)
			}
		}
	}

	for _, item := range s.usersForIDs(c.Request.Context(), uniqueObjectIDs(memberIDs)) {
		addUser(item)
	}

	rows := map[primitive.ObjectID]*teamPerformanceMember{}
	for _, item := range userMap {
		rows[item.ID] = &teamPerformanceMember{
			ID:        item.ID,
			Name:      item.Name,
			Username:  item.Username,
			Email:     item.Email,
			AvatarURL: item.AvatarURL,
			Role:      item.Role,
			StaffRole: item.StaffRole,
		}
	}

	for _, task := range tasks {
		createdInPeriod := !task.CreatedAt.IsZero() && !task.CreatedAt.Before(from)
		updatedInPeriod := !task.UpdatedAt.IsZero() && !task.UpdatedAt.Before(from)
		activeInPeriod := createdInPeriod || updatedInPeriod
		done := performanceDoneStatus(task.Status)
		overdue := task.DueDate != nil && task.DueDate.Before(today) && !done
		isAnnotation := task.Type == "annotation" || len(task.Annotations) > 0

		if row := rows[task.CreatedBy]; row != nil && createdInPeriod {
			row.CreatedTasks++
		}
		for _, assigneeID := range uniqueObjectIDs(task.AssigneeIDs) {
			row := rows[assigneeID]
			if row == nil {
				continue
			}
			if activeInPeriod {
				row.AssignedTasks++
				if isAnnotation {
					row.AnnotationTasks++
				}
			}
			if done && activeInPeriod {
				row.CompletedTasks++
			}
			if !done {
				row.OpenTasks++
			}
			if overdue {
				row.OverdueTasks++
			}
		}
	}

	if len(clientIDs) > 0 {
		commentFilter := bson.M{"client_id": bson.M{"$in": clientIDs}, "created_at": bson.M{"$gte": from}}
		cursor, err := s.store.C("client_task_comments").Find(c.Request.Context(), commentFilter, options.Find().SetLimit(10000))
		if err == nil {
			defer cursor.Close(c.Request.Context())
			for cursor.Next(c.Request.Context()) {
				var comment models.ClientTaskComment
				if cursor.Decode(&comment) == nil {
					if row := rows[comment.AuthorID]; row != nil {
						row.Comments++
					}
				}
			}
		}
	}

	if len(taskIDs) > 0 {
		timeFilter := bson.M{"task_id": bson.M{"$in": taskIDs}, "start_time": bson.M{"$gte": from}}
		if len(teamIDs) > 0 {
			timeFilter["team_id"] = bson.M{"$in": uniqueObjectIDs(teamIDs)}
		}
		cursor, err := s.store.C("time_entries").Find(c.Request.Context(), timeFilter, options.Find().SetLimit(10000))
		if err == nil {
			defer cursor.Close(c.Request.Context())
			for cursor.Next(c.Request.Context()) {
				var entry models.TimeEntry
				if cursor.Decode(&entry) == nil {
					if row := rows[entry.UserID]; row != nil {
						row.TimeMinutes += entry.DurationMinutes
					}
				}
			}
		}
	}

	members := make([]teamPerformanceMember, 0, len(rows))
	summary := gin.H{
		"members":          0,
		"assigned_tasks":   0,
		"created_tasks":    0,
		"completed_tasks":  0,
		"open_tasks":       0,
		"overdue_tasks":    0,
		"annotation_tasks": 0,
		"comments":         0,
		"time_minutes":     0,
	}
	for _, row := range rows {
		row.Score = row.CompletedTasks*4 + row.CreatedTasks*2 + row.Comments + row.TimeMinutes/30 + row.AssignedTasks - row.OverdueTasks*2
		if row.Score < 0 {
			row.Score = 0
		}
		members = append(members, *row)
		summary["members"] = summary["members"].(int) + 1
		summary["assigned_tasks"] = summary["assigned_tasks"].(int) + row.AssignedTasks
		summary["created_tasks"] = summary["created_tasks"].(int) + row.CreatedTasks
		summary["completed_tasks"] = summary["completed_tasks"].(int) + row.CompletedTasks
		summary["open_tasks"] = summary["open_tasks"].(int) + row.OpenTasks
		summary["overdue_tasks"] = summary["overdue_tasks"].(int) + row.OverdueTasks
		summary["annotation_tasks"] = summary["annotation_tasks"].(int) + row.AnnotationTasks
		summary["comments"] = summary["comments"].(int) + row.Comments
		summary["time_minutes"] = summary["time_minutes"].(int) + row.TimeMinutes
	}

	sort.Slice(members, func(i, j int) bool {
		if members[i].Score != members[j].Score {
			return members[i].Score > members[j].Score
		}
		if members[i].CompletedTasks != members[j].CompletedTasks {
			return members[i].CompletedTasks > members[j].CompletedTasks
		}
		return strings.ToLower(members[i].Name) < strings.ToLower(members[j].Name)
	})

	c.JSON(http.StatusOK, gin.H{
		"period":  period,
		"from":    from,
		"to":      now,
		"members": members,
		"summary": summary,
	})
}

func (s *Server) performanceClientProjects(c *gin.Context, userCtx middleware.UserContext) ([]models.ClientProject, error) {
	filter := bson.M{}
	switch userCtx.Role {
	case models.RoleOwnerAdmin:
	case models.RoleTeamAdmin:
		filter["team_id"] = userCtx.TeamID
	default:
		filter["$or"] = []bson.M{
			{"member_ids": userCtx.ID},
			{"client_admin_ids": userCtx.ID},
			{"created_by": userCtx.ID},
		}
	}
	cursor, err := s.store.C("client_projects").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}).SetLimit(1000))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(c.Request.Context())
	clients := []models.ClientProject{}
	for cursor.Next(c.Request.Context()) {
		var client models.ClientProject
		if cursor.Decode(&client) == nil {
			clients = append(clients, client)
		}
	}
	return clients, nil
}

func (s *Server) performanceWorkspaceUsers(c *gin.Context, userCtx middleware.UserContext, memberIDs []primitive.ObjectID) []models.User {
	filter := bson.M{"status": models.StatusActive}
	switch userCtx.Role {
	case models.RoleOwnerAdmin:
		if len(memberIDs) > 0 {
			filter["_id"] = bson.M{"$in": memberIDs}
		}
	case models.RoleTeamAdmin:
		filter["team_id"] = userCtx.TeamID
	default:
		if len(memberIDs) == 0 {
			filter["_id"] = userCtx.ID
		} else {
			filter["_id"] = bson.M{"$in": memberIDs}
		}
	}
	cursor, err := s.store.C("users").Find(c.Request.Context(), filter, options.Find().SetProjection(bson.M{"password_hash": 0, "refresh_token_hash": 0, "two_factor_secret": 0}).SetSort(bson.D{{Key: "name", Value: 1}}).SetLimit(500))
	if err != nil {
		return []models.User{}
	}
	defer cursor.Close(c.Request.Context())
	users := []models.User{}
	for cursor.Next(c.Request.Context()) {
		var user models.User
		if cursor.Decode(&user) == nil {
			users = append(users, user)
		}
	}
	return users
}

func normalizePerformancePeriod(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "daily", "weekly", "monthly", "yearly":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "weekly"
	}
}

func performancePeriodStart(now time.Time, period string) time.Time {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	switch period {
	case "daily":
		return day
	case "monthly":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	case "yearly":
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	default:
		offset := int(day.Weekday())
		if offset == 0 {
			offset = 7
		}
		return day.AddDate(0, 0, -(offset - 1))
	}
}

func performanceDoneStatus(status string) bool {
	normalized := strings.ToLower(strings.TrimSpace(status))
	return normalized == "done" || normalized == "complete" || normalized == "completed" || strings.Contains(normalized, "complete")
}
