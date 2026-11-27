package handlers

import (
	"context"
	"net/http"
	"sort"
	"strings"
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
	Kind           string             `json:"kind"`
	Name           string             `json:"name"`
	Subdomain      string             `json:"subdomain,omitempty"`
	CustomDomain   string             `json:"custom_domain,omitempty"`
	RootDir        string             `json:"root_dir,omitempty"`
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
	RetentionDays  int                `json:"retention_days"`
	ClientHidden   bool               `json:"client_hidden,omitempty"`
	ExpiresAt      time.Time          `json:"expires_at"`
	DomainsCount   int64              `json:"domains_count"`
	TasksCount     int64              `json:"tasks_count"`
	DocumentsCount int64              `json:"documents_count"`
}

// adminListDeletedProjects returns paginated soft-deleted projects & websites for the platform owner,
// automatically purging records whose retention period (>35 days) has expired.
func (s *Server) adminListDeletedProjects(c *gin.Context) {
	ctx := c.Request.Context()
	s.purgeExpiredDeletedProjects(ctx)

	pag := s.parseListPagination(c)
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))

	projectFilter := bson.M{
		"deleted_at": bson.M{"$exists": true, "$ne": nil},
	}
	cursor, err := s.store.C("client_projects").Find(
		ctx,
		projectFilter,
		options.Find().
			SetProjection(bson.M{
				"_id":           1,
				"name":          1,
				"company_email": 1,
				"contact_name":  1,
				"details":       1,
				"team_id":       1,
				"deleted_at":    1,
				"deleted_by":    1,
			}).
			SetSort(bson.D{{Key: "deleted_at", Value: -1}}),
	)
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

	var deletedTenants []models.Tenant
	if tCur, err := s.store.C("tenants").Find(
		ctx,
		bson.M{"$or": []bson.M{
			{"is_deleted": true},
			{"status": models.TenantStatusDeleted},
		}},
		options.Find().
			SetProjection(bson.M{
				"_id":           1,
				"company_name":  1,
				"subdomain":     1,
				"custom_domain": 1,
				"owner_user_id": 1,
				"updated_at":    1,
				"deleted_at":    1,
				"purge_at":      1,
				"deleted_by":    1,
				"client_hidden": 1,
			}).
			SetSort(bson.D{{Key: "deleted_at", Value: -1}, {Key: "updated_at", Value: -1}}),
	); err == nil {
		defer tCur.Close(ctx)
		_ = tCur.All(ctx, &deletedTenants)
	}

	type deletedCandidate struct {
		kind      string
		deletedAt time.Time
		project   *models.ClientProject
		tenant    *models.Tenant
	}

	totalInRetention := int64(len(projects) + len(deletedTenants))
	candidates := make([]deletedCandidate, 0, len(projects)+len(deletedTenants))

	// Collect IDs needed for search matching only when a search query is given
	searchTeamNames := map[primitive.ObjectID]string{}
	searchOwners := map[primitive.ObjectID]models.User{}
	if q != "" {
		teamIDs := make([]primitive.ObjectID, 0, len(projects))
		for _, p := range projects {
			if !p.TeamID.IsZero() {
				teamIDs = append(teamIDs, p.TeamID)
			}
		}
		if len(teamIDs) > 0 {
			if tc, err := s.store.C("teams").Find(ctx, bson.M{"_id": bson.M{"$in": uniqueObjectIDs(teamIDs)}}, options.Find().SetProjection(bson.M{"_id": 1, "name": 1})); err == nil {
				defer tc.Close(ctx)
				for tc.Next(ctx) {
					var t models.Team
					if tc.Decode(&t) == nil {
						searchTeamNames[t.ID] = t.Name
					}
				}
			}
		}
		ownerIDs := make([]primitive.ObjectID, 0, len(deletedTenants))
		for _, t := range deletedTenants {
			if !t.OwnerUserID.IsZero() {
				ownerIDs = append(ownerIDs, t.OwnerUserID)
			}
		}
		if len(ownerIDs) > 0 {
			for _, u := range s.usersForIDs(ctx, uniqueObjectIDs(ownerIDs)) {
				searchOwners[u.ID] = u
			}
		}
	}

	for i := range projects {
		p := &projects[i]
		if q != "" {
			hay := strings.ToLower(p.Name + " " + p.CompanyEmail + " " + p.ContactName + " " + searchTeamNames[p.TeamID])
			if !strings.Contains(hay, q) {
				continue
			}
		}
		deletedAt := time.Time{}
		if p.DeletedAt != nil {
			deletedAt = *p.DeletedAt
		}
		candidates = append(candidates, deletedCandidate{
			kind:      "project",
			deletedAt: deletedAt,
			project:   p,
		})
	}

	for i := range deletedTenants {
		t := &deletedTenants[i]
		if q != "" {
			owner := searchOwners[t.OwnerUserID]
			hay := strings.ToLower(t.CompanyName + " " + t.Subdomain + " " + t.CustomDomain + " " + owner.Email + " " + owner.Name)
			if !strings.Contains(hay, q) {
				continue
			}
		}
		deletedAt := t.UpdatedAt
		if t.DeletedAt != nil {
			deletedAt = *t.DeletedAt
		}
		candidates = append(candidates, deletedCandidate{
			kind:      "website",
			deletedAt: deletedAt,
			tenant:    t,
		})
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].deletedAt.After(candidates[j].deletedAt)
	})

	pageCandidates, meta := paginateSlice(candidates, pag.Page, pag.Limit)

	// Hydrate heavy counts, users, and team names ONLY for the current page's items.
	pageUserIDs := []primitive.ObjectID{}
	pageTeamIDs := []primitive.ObjectID{}
	for _, cand := range pageCandidates {
		if cand.project != nil {
			if cand.project.DeletedBy != nil && !cand.project.DeletedBy.IsZero() {
				pageUserIDs = append(pageUserIDs, *cand.project.DeletedBy)
			}
			if !cand.project.TeamID.IsZero() {
				pageTeamIDs = append(pageTeamIDs, cand.project.TeamID)
			}
		} else if cand.tenant != nil {
			if !cand.tenant.OwnerUserID.IsZero() {
				pageUserIDs = append(pageUserIDs, cand.tenant.OwnerUserID)
			}
			if cand.tenant.DeletedBy != nil && !cand.tenant.DeletedBy.IsZero() {
				pageUserIDs = append(pageUserIDs, *cand.tenant.DeletedBy)
			}
		}
	}

	usersByID := map[primitive.ObjectID]models.User{}
	if len(pageUserIDs) > 0 {
		for _, u := range s.usersForIDs(ctx, uniqueObjectIDs(pageUserIDs)) {
			usersByID[u.ID] = u
		}
	}

	teamsByID := map[primitive.ObjectID]string{}
	if len(pageTeamIDs) > 0 {
		if tCursor, err := s.store.C("teams").Find(ctx, bson.M{"_id": bson.M{"$in": uniqueObjectIDs(pageTeamIDs)}}, options.Find().SetProjection(bson.M{"_id": 1, "name": 1})); err == nil {
			defer tCursor.Close(ctx)
			for tCursor.Next(ctx) {
				var t models.Team
				if tCursor.Decode(&t) == nil {
					teamsByID[t.ID] = t.Name
				}
			}
		}
	}

	rows := make([]AdminDeletedProjectRow, 0, len(pageCandidates))
	now := time.Now().UTC()
	baseDomain := s.tenantBaseDomain()

	for _, cand := range pageCandidates {
		if cand.project != nil {
			p := cand.project
			deletedAt := cand.deletedAt
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
				Kind:           "project",
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
				RetentionDays:  PlatformOwnerRetentionDays,
				ExpiresAt:      expiresAt,
				DomainsCount:   domainsCount,
				TasksCount:     tasksCount,
				DocumentsCount: documentsCount,
			})
			continue
		}

		t := cand.tenant
		deletedAt := cand.deletedAt
		expiresAt := deletedAt.Add(time.Duration(TenantDeletionGraceDays) * 24 * time.Hour)
		if t.PurgeAt != nil {
			expiresAt = *t.PurgeAt
		}
		hoursLeft := expiresAt.Sub(now).Hours()
		daysRemaining := int(hoursLeft / 24)
		if daysRemaining < 0 {
			daysRemaining = 0
		} else if hoursLeft > 0 && daysRemaining == 0 {
			daysRemaining = 1
		}

		owner := usersByID[t.OwnerUserID]
		ownerName := firstNonEmpty(strings.TrimSpace(owner.Name), owner.Username, owner.Email, "Client")
		deletedByID := primitive.NilObjectID
		deletedByName := ""
		deletedByEmail := ""
		if t.DeletedBy != nil {
			deletedByID = *t.DeletedBy
			if du, ok := usersByID[deletedByID]; ok {
				deletedByName = du.Name
				deletedByEmail = du.Email
			}
		}

		subCount, _ := s.store.C("tenant_form_submissions").CountDocuments(ctx, bson.M{"tenant_id": t.ID})
		domainLabel := t.Subdomain + "." + baseDomain
		if strings.TrimSpace(t.CustomDomain) != "" {
			domainLabel += " (" + strings.TrimSpace(t.CustomDomain) + ")"
		}
		var domainCount int64 = 1
		if strings.TrimSpace(t.CustomDomain) != "" {
			domainCount = 2
		}

		detailsText := "Website Builder Store · " + domainLabel + " · Directory: " + s.tenantRootDir(t.Subdomain)
		if t.ClientHidden {
			detailsText = "Unlisted by client (retained for Platform Owner) · " + detailsText
		}

		rows = append(rows, AdminDeletedProjectRow{
			ID:             t.ID,
			Kind:           "website",
			Name:           firstNonEmpty(t.CompanyName, t.Subdomain),
			Subdomain:      t.Subdomain,
			CustomDomain:   t.CustomDomain,
			RootDir:        s.tenantRootDir(t.Subdomain),
			CompanyEmail:   owner.Email,
			ContactName:    ownerName,
			Details:        detailsText,
			DeletedAt:      deletedAt,
			DeletedByID:    deletedByID,
			DeletedByName:  deletedByName,
			DeletedByEmail: deletedByEmail,
			DaysRemaining:  daysRemaining,
			RetentionDays:  TenantDeletionGraceDays,
			ClientHidden:   t.ClientHidden,
			ExpiresAt:      expiresAt,
			DomainsCount:   domainCount,
			TasksCount:     subCount,
			DocumentsCount: 0,
			TeamName:       domainLabel,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"projects":             rows,
		"total_in_retention":   totalInRetention,
		"pagination":           meta,
		"default_limit":        pag.DefaultLimit,
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
		if tenant, tErr := s.store.GetTenantByID(ctx, projectID); tErr == nil && tenant != nil {
			restoreStatus := models.TenantStatusActive
			if tenant.PublishedAt == nil {
				restoreStatus = models.TenantStatusDraft
			}
			if err := s.store.UpdateTenant(ctx, tenant.ID, bson.M{
				"is_deleted":         false,
				"status":             restoreStatus,
				"deleted_at":         nil,
				"purge_at":           nil,
				"deleted_by":         nil,
				"client_hidden":      false,
				"client_unlisted_at": nil,
			}); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "could not restore website"})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"restored": true,
				"kind":     "website",
				"id":       tenant.ID,
				"name":     firstNonEmpty(tenant.CompanyName, tenant.Subdomain),
			})
			return
		}
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
		if tenant, tErr := s.store.GetTenantByID(ctx, projectID); tErr == nil && tenant != nil {
			s.performPermanentTenantDelete(c, tenant)
			return
		}
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
