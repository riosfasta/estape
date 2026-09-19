package handlers

import (
	"context"
	"net/http"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	PlatformOwnerRetentionDays = 35
	ClientRecoveryNoticeDays   = 15
)

type AdminDeletedProjectRow struct {
	ID             primitive.ObjectID `json:"id"`
	Name           string             `json:"name"`
	CompanyEmail   string             `json:"company_email"`
	ContactName    string             `json:"contact_name"`
	Details        string             `json:"details"`
	TeamID         primitive.ObjectID `json:"team_id"`
	TeamName       string             `json:"team_name"`
	DeletedAt      time.Time          `json:"deleted_at"`
	DeletedByID    primitive.ObjectID `json:"deleted_by_id"`
	DeletedByName  string             `json:"deleted_by_name"`
	DeletedByEmail string             `json:"deleted_by_email"`
	DaysRemaining  int                `json:"days_remaining"`
	ExpiresAt      time.Time          `json:"expires_at"`
	DomainsCount   int64              `json:"domains_count"`
	TasksCount     int64              `json:"tasks_count"`
	DocumentsCount int64              `json:"documents_count"`
}

// adminListDeletedProjects returns all soft-deleted projects for the platform owner,
// automatically purging records whose retention period (>35 days) has expired.
func (s *Server) adminListDeletedProjects(c *gin.Context) {
	ctx := c.Request.Context()
	s.purgeExpiredDeletedProjects(ctx)

	filter := bson.M{
		"deleted_at": bson.M{"$exists": true, "$ne": nil},
	}

	cursor, err := s.store.C("client_projects").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "deleted_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load deleted projects"})
		return
	}
	defer cursor.Close(ctx)

	var projects []models.ClientProject
	if err := cursor.All(ctx, &projects); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode deleted projects"})
		return
	}

	userIDs := []primitive.ObjectID{}
	teamIDs := []primitive.ObjectID{}
	for _, p := range projects {
		if p.DeletedBy != nil && !p.DeletedBy.IsZero() {
			userIDs = append(userIDs, *p.DeletedBy)
		}
		if !p.TeamID.IsZero() {
			teamIDs = append(teamIDs, p.TeamID)
		}
	}

	usersByID := map[primitive.ObjectID]models.User{}
	if len(userIDs) > 0 {
		for _, u := range s.usersForIDs(ctx, uniqueObjectIDs(userIDs)) {
			usersByID[u.ID] = u
		}
	}

	teamsByID := map[primitive.ObjectID]string{}
	if len(teamIDs) > 0 {
		if tCursor, err := s.store.C("teams").Find(ctx, bson.M{"_id": bson.M{"$in": uniqueObjectIDs(teamIDs)}}); err == nil {
			defer tCursor.Close(ctx)
			for tCursor.Next(ctx) {
				var t models.Team
				if tCursor.Decode(&t) == nil {
					teamsByID[t.ID] = t.Name
				}
			}
		}
	}

	rows := make([]AdminDeletedProjectRow, 0, len(projects))
	now := time.Now().UTC()

	for _, p := range projects {
		deletedAt := time.Time{}
		if p.DeletedAt != nil {
			deletedAt = *p.DeletedAt
		}
		expiresAt := deletedAt.Add(time.Duration(PlatformOwnerRetentionDays) * 24 * time.Hour)
		hoursLeft := expiresAt.Sub(now).Hours()
		daysRemaining := int(hoursLeft / 24)
		if daysRemaining < 0 {
			daysRemaining = 0
		} else if hoursLeft > 0 && daysRemaining == 0 {
			daysRemaining = 1
		}

		domainsCount, _ := s.store.C("client_websites").CountDocuments(ctx, bson.M{"client_id": p.ID})
		tasksCount, _ := s.store.C("client_tasks").CountDocuments(ctx, bson.M{"client_id": p.ID})
		documentsCount, _ := s.store.C("client_documents").CountDocuments(ctx, bson.M{"client_id": p.ID})

		deletedByID := primitive.NilObjectID
		deletedByName := ""
		deletedByEmail := ""
		if p.DeletedBy != nil {
			deletedByID = *p.DeletedBy
			if u, ok := usersByID[deletedByID]; ok {
				deletedByName = u.Name
				deletedByEmail = u.Email
			}
		}

		teamName := teamsByID[p.TeamID]
		if teamName == "" {
			teamName = "Default workspace"
		}

		rows = append(rows, AdminDeletedProjectRow{
			ID:             p.ID,
			Name:           p.Name,
			CompanyEmail:   p.CompanyEmail,
			ContactName:    p.ContactName,
			Details:        p.Details,
			TeamID:         p.TeamID,
			TeamName:       teamName,
			DeletedAt:      deletedAt,
			DeletedByID:    deletedByID,
			DeletedByName:  deletedByName,
			DeletedByEmail: deletedByEmail,
			DaysRemaining:  daysRemaining,
			ExpiresAt:      expiresAt,
			DomainsCount:   domainsCount,
			TasksCount:     tasksCount,
			DocumentsCount: documentsCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"projects":             rows,
		"retention_days":       PlatformOwnerRetentionDays,
		"client_recovery_days": ClientRecoveryNoticeDays,
	})
}

// adminRestoreDeletedProject restores a softly deleted client project and all domains & assets inside.
func (s *Server) adminRestoreDeletedProject(c *gin.Context) {
	projectID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}

	ctx := c.Request.Context()
	var project models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": projectID}).Decode(&project); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "deleted project not found"})
		return
	}

	unset := bson.M{
		"$unset": bson.M{
			"deleted_at": "",
			"deleted_by": "",
		},
		"$set": bson.M{
			"updated_at": time.Now().UTC(),
		},
	}

	if _, err := s.store.C("client_projects").UpdateByID(ctx, project.ID, unset); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not restore client project"})
		return
	}

	childUnset := bson.M{
		"$unset": bson.M{
			"deleted_at": "",
			"deleted_by": "",
		},
	}
	_, _ = s.store.C("client_websites").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)
	_, _ = s.store.C("client_documents").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)
	_, _ = s.store.C("client_tabs").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)
	_, _ = s.store.C("client_tasks").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)
	_, _ = s.store.C("client_task_comments").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)
	_, _ = s.store.C("client_task_logs").UpdateMany(ctx, bson.M{"client_id": project.ID}, childUnset)

	c.JSON(http.StatusOK, gin.H{
		"restored": true,
		"id":       project.ID,
		"name":     project.Name,
	})
}

// adminPermanentDeleteProject permanently destroys a client project and all domains & assets inside.
func (s *Server) adminPermanentDeleteProject(c *gin.Context) {
	projectID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}

	ctx := c.Request.Context()
	var project models.ClientProject
	if err := s.store.C("client_projects").FindOne(ctx, bson.M{"_id": projectID}).Decode(&project); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if _, err := s.store.C("client_projects").DeleteOne(ctx, bson.M{"_id": project.ID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not permanently delete project"})
		return
	}

	s.deleteClientTaskNotificationsForFilter(ctx, bson.M{"client_id": project.ID})
	s.deleteNotificationsByRelatedIDs(ctx, []primitive.ObjectID{project.ID}, "client_project_added", "client_project_role_updated")

	_, _ = s.store.C("client_websites").DeleteMany(ctx, bson.M{"client_id": project.ID})
	_, _ = s.store.C("client_documents").DeleteMany(ctx, bson.M{"client_id": project.ID})
	_, _ = s.store.C("client_tabs").DeleteMany(ctx, bson.M{"client_id": project.ID})
	_, _ = s.store.C("client_tasks").DeleteMany(ctx, bson.M{"client_id": project.ID})
	_, _ = s.store.C("client_task_comments").DeleteMany(ctx, bson.M{"client_id": project.ID})
	_, _ = s.store.C("client_task_logs").DeleteMany(ctx, bson.M{"client_id": project.ID})

	c.JSON(http.StatusOK, gin.H{
		"deleted":   true,
		"permanent": true,
		"id":        project.ID,
	})
}

// purgeExpiredDeletedProjects automatically removes any project that was soft-deleted more than 35 days ago.
func (s *Server) purgeExpiredDeletedProjects(ctx context.Context) {
	if s.store == nil {
		return
	}
	cutoff := time.Now().UTC().Add(-time.Duration(PlatformOwnerRetentionDays) * 24 * time.Hour)
	filter := bson.M{
		"deleted_at": bson.M{"$lte": cutoff},
	}

	cursor, err := s.store.C("client_projects").Find(ctx, filter, options.Find().SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return
	}
	defer cursor.Close(ctx)

	var expired []struct {
		ID primitive.ObjectID `bson:"_id"`
	}
	if err := cursor.All(ctx, &expired); err != nil || len(expired) == 0 {
		return
	}

	for _, item := range expired {
		_, _ = s.store.C("client_projects").DeleteOne(ctx, bson.M{"_id": item.ID})
		s.deleteClientTaskNotificationsForFilter(ctx, bson.M{"client_id": item.ID})
		s.deleteNotificationsByRelatedIDs(ctx, []primitive.ObjectID{item.ID}, "client_project_added", "client_project_role_updated")
		_, _ = s.store.C("client_websites").DeleteMany(ctx, bson.M{"client_id": item.ID})
		_, _ = s.store.C("client_documents").DeleteMany(ctx, bson.M{"client_id": item.ID})
		_, _ = s.store.C("client_tabs").DeleteMany(ctx, bson.M{"client_id": item.ID})
		_, _ = s.store.C("client_tasks").DeleteMany(ctx, bson.M{"client_id": item.ID})
		_, _ = s.store.C("client_task_comments").DeleteMany(ctx, bson.M{"client_id": item.ID})
		_, _ = s.store.C("client_task_logs").DeleteMany(ctx, bson.M{"client_id": item.ID})
	}
}
