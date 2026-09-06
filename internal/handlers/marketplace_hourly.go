package handlers

import (
	"regexp"
	"sort"
	"strings"
	"time"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func validateHourlyJob(j models.MarketplaceJob) error {
	if j.BillingType == "" || j.BillingType == "fixed" {
		if j.HourlyRate != 0 || j.MaxSeconds != 0 {
			return marketInvalid("Hourly limits only apply to hourly jobs")
		}
		return nil
	}
	if j.BillingType != "hourly" || j.HourlyRate < 100 || j.HourlyRate > maximumMarketplaceAmount || j.MaxSeconds < 60 || j.MaxSeconds > 36000000 || j.Budget < 100 || j.Budget > maximumMarketplaceAmount || len(j.ScopeTasks) == 0 || j.ScopePriceMode != "domain" {
		return marketInvalid("Hourly work requires selected tasks, a $1-$100,000 hourly rate and maximum cost, and a time limit from 1 minute to 10,000 hours. Use one shared limit for the contract.")
	}
	if hourlySecondLimit(j) < 1 {
		return marketInvalid("The cost limit is too small for this hourly rate")
	}
	return nil
}

func hourlySecondLimit(j models.MarketplaceJob) int64 {
	if j.HourlyRate <= 0 {
		return 0
	}
	return min(j.MaxSeconds, j.Budget*3600/j.HourlyRate)
}

func hourlySeconds(j models.MarketplaceJob, now time.Time) int64 {
	seconds := j.TrackedSeconds
	if j.TimerStartedAt != nil && j.TimerUntil != nil {
		end := now
		if end.After(*j.TimerUntil) {
			end = *j.TimerUntil
		}
		seconds += max(int64(0), int64(end.Sub(*j.TimerStartedAt)/time.Second))
	}
	return min(max(int64(0), seconds), hourlySecondLimit(j))
}

func hourlyAmount(j models.MarketplaceJob, seconds int64) int64 {
	return min(j.Budget, (max(int64(0), min(seconds, hourlySecondLimit(j)))*j.HourlyRate+3599)/3600)
}

// Server time is authoritative. A deadline caps billable time even with the
// browser closed. Records are finalized on stop, submission or the next start.
func (s *Server) finishHourlyTimer(sc mongo.SessionContext, j *models.MarketplaceJob, now time.Time) error {
	if j.TimerStartedAt == nil {
		return nil
	}
	total := hourlySeconds(*j, now)
	seconds := max(int64(0), total-j.TrackedSeconds)
	end := j.TimerStartedAt.Add(time.Duration(seconds) * time.Second)
	var task models.ClientTask
	_ = s.store.C("client_tasks").FindOne(sc, bson.M{"_id": j.TimerTaskID}).Decode(&task)
	entry := models.TimeEntry{ID: primitive.NewObjectID(), MarketplaceJobID: j.ID, TaskID: j.TimerTaskID, UserID: j.FreelancerID, TeamID: task.TeamID, StartTime: *j.TimerStartedAt, EndTime: &end, DurationSeconds: seconds, DurationMinutes: int(seconds / 60), Billable: true, Note: "Protected hourly contract timer", CreatedAt: now}
	if _, err := s.store.C("time_entries").InsertOne(sc, entry); err != nil {
		return err
	}
	_, err := s.store.C("marketplace_jobs").UpdateByID(sc, j.ID, bson.M{"$set": bson.M{"tracked_seconds": total}, "$unset": bson.M{"timer_started_at": "", "timer_until": "", "timer_task_id": ""}})
	if err == nil {
		j.TrackedSeconds = total
		j.TimerStartedAt = nil
		j.TimerUntil = nil
		j.TimerTaskID = primitive.NilObjectID
	}
	return err
}

func hourlySummary(j models.MarketplaceJob, userID primitive.ObjectID) gin.H {
	now := time.Now().UTC()
	seconds := hourlySeconds(j, now)
	running := j.TimerStartedAt != nil && j.TimerUntil != nil && now.Before(*j.TimerUntil)
	return gin.H{"billing_type": j.BillingType, "hourly_rate": j.HourlyRate, "max_seconds": j.MaxSeconds, "max_cost": j.Budget, "seconds": seconds, "cost": hourlyAmount(j, seconds), "remaining_seconds": max(int64(0), hourlySecondLimit(j)-seconds), "running": running, "task_id": j.TimerTaskID, "until": j.TimerUntil, "can_track": userID == j.FreelancerID && j.Status == "hired", "can_stop": (userID == j.FreelancerID || userID == j.OwnerID) && j.TimerStartedAt != nil}
}

func (s *Server) marketplaceTimer(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	var req struct {
		TaskID primitive.ObjectID `json:"task_id"`
	}
	if c.ShouldBindJSON(&req) != nil {
		marketplaceError(c, marketInvalid("Invalid timer request"))
		return
	}
	action := c.Param("timerAction")
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		j, _, err := s.loadScopedJob(sc, id, user.ID)
		if err != nil {
			return err
		}
		if j.BillingType != "hourly" || j.Status != "hired" || (user.ID != j.FreelancerID && !(action == "stop" && user.ID == j.OwnerID)) {
			return marketInvalid("Only an active hourly hire can track time")
		}
		// Serialize starts across all contracts for this freelancer.
		if _, err = s.store.C("freelancer_profiles").UpdateByID(sc, j.FreelancerID, bson.M{"$inc": bson.M{"timer_revision": 1}}); err != nil {
			return err
		}
		now := time.Now().UTC()
		if action == "stop" {
			return s.finishHourlyTimer(sc, &j, now)
		}
		if action != "start" || !scopedJobContains(j, req.TaskID) {
			return marketInvalid("Choose a task in this hourly contract")
		}
		var task models.ClientTask
		if err = s.store.C("client_tasks").FindOne(sc, bson.M{"_id": req.TaskID}).Decode(&task); err != nil {
			return marketInvalid("This task is no longer available")
		}
		cursor, err := s.store.C("marketplace_jobs").Find(sc, bson.M{"freelancer_id": j.FreelancerID, "timer_started_at": bson.M{"$ne": nil}})
		if err != nil {
			return err
		}
		var running []models.MarketplaceJob
		err = cursor.All(sc, &running)
		cursor.Close(sc)
		if err != nil {
			return err
		}
		for _, previous := range running {
			if previous.TimerUntil != nil && now.Before(*previous.TimerUntil) {
				if previous.ID == j.ID && previous.TimerTaskID == req.TaskID {
					return nil
				}
				return marketInvalid("Stop your running contract timer before starting another task")
			}
			if err = s.finishHourlyTimer(sc, &previous, now); err != nil {
				return err
			}
			if previous.ID == j.ID {
				j = previous
			}
		}
		remaining := hourlySecondLimit(j) - j.TrackedSeconds
		if remaining <= 0 {
			return marketInvalid("The agreed hours or cost limit has been reached")
		}
		deadline := now.Add(time.Duration(remaining) * time.Second)
		_, err = s.store.C("marketplace_jobs").UpdateByID(sc, j.ID, bson.M{"$set": bson.M{"timer_started_at": now, "timer_until": deadline, "timer_task_id": req.TaskID}})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) marketplaceSkillOptions(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) > 60 {
		marketplaceError(c, marketInvalid("Search up to 60 characters"))
		return
	}
	pipeline := mongo.Pipeline{
		{{Key: "$unwind", Value: "$skills"}},
		{{Key: "$match", Value: bson.M{"skills": bson.M{"$regex": regexp.QuoteMeta(q), "$options": "i"}}}},
		{{Key: "$group", Value: bson.M{"_id": bson.M{"$toLower": "$skills"}, "skill": bson.M{"$first": "$skills"}}}},
		{{Key: "$sort", Value: bson.M{"_id": 1}}}, {{Key: "$limit", Value: 101}},
	}
	cur, err := s.store.C("freelancer_profiles").Aggregate(c.Request.Context(), pipeline, options.Aggregate().SetMaxTime(5*time.Second))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(c.Request.Context())
	var rows []struct {
		Skill string `bson:"skill"`
	}
	if marketplaceError(c, cur.All(c.Request.Context(), &rows)) {
		return
	}
	choices := map[string]string{}
	for _, r := range rows {
		if len(r.Skill) <= 60 && strings.TrimSpace(r.Skill) != "" {
			choices[strings.ToLower(r.Skill)] = r.Skill
		}
	}
	for _, skill := range freelancerSkills {
		if strings.Contains(strings.ToLower(skill), strings.ToLower(q)) {
			choices[strings.ToLower(skill)] = skill
		}
	}
	list := []string{}
	for _, skill := range choices {
		list = append(list, skill)
	}
	sort.Slice(list, func(i, j int) bool { return strings.ToLower(list[i]) < strings.ToLower(list[j]) })
	more := len(list) > 100 || len(rows) > 100
	if len(list) > 100 {
		list = list[:100]
	}
	c.JSON(200, gin.H{"skills": list, "has_more": more})
}
