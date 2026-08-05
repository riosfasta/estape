package handlers

import (
	"context"
	"errors"
	"fmt"
	template "html/template"
	"net/http"
	"sort"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/billing"
	"bugmark/internal/config"
	"bugmark/internal/email"
	"bugmark/internal/integrations"
	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"bugmark/internal/realtime"
	"bugmark/internal/store"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Server struct {
	cfg          config.Config
	store        *store.Store
	tokens       *auth.TokenManager
	mailer       *email.Worker
	hub          *realtime.Hub
	push         *PushService
	payments     map[string]billing.PaymentProvider
	integrations map[string]integrations.TaskIntegrationProvider
}

func New(cfg config.Config, store *store.Store, tokens *auth.TokenManager, mailer *email.Worker, hub *realtime.Hub, payments map[string]billing.PaymentProvider, taskIntegrations map[string]integrations.TaskIntegrationProvider) *Server {
	return &Server{cfg: cfg, store: store, tokens: tokens, mailer: mailer, hub: hub, push: NewPushService(cfg), payments: payments, integrations: taskIntegrations}
}

func (s *Server) Router() *gin.Engine {
	router := gin.Default()
	router.MaxMultipartMemory = 16 << 20
	router.Static("/static", "web/static")
	router.Static("/uploads", s.cfg.UploadDir)
	router.LoadHTMLGlob("web/templates/*.gohtml")
	router.Use(s.securityHeaders())

	router.GET("/", s.homePage)
	router.GET("/pricing", s.homePage)
	router.GET("/legal/:slug", s.publicLegalPage)
	router.GET("/p/:slug", s.publicStaticPage)
	router.GET("/login", s.appPage)
	router.GET("/register", s.appPage)
	router.GET("/dashboard", s.appPage)
	router.GET("/team", s.appPage)
	router.GET("/tasks", s.appPage)
	router.GET("/projects", s.appPage)
	router.GET("/spaces/:id", s.appPage)
	router.GET("/projects/:id", s.appPage)
	router.GET("/projects/:id/sites/:websiteId", s.appPage)
	router.GET("/websites", s.appPage)
	router.GET("/websites/:id/annotate", s.appPage)
	router.GET("/chat", s.appPage)
	router.GET("/team/performance", s.appPage)
	router.GET("/admin", s.appPage)
	router.GET("/admin/users", s.appPage)
	router.GET("/admin/settings", s.appPage)
	router.GET("/admin/plans", s.appPage)
	router.GET("/admin/pages", s.appPage)
	router.GET("/admin/pages/:slug/edit", s.appPage)
	router.GET("/settings/company", s.appPage)
	router.GET("/settings/billing", s.appPage)
	router.GET("/team/integrations", s.appPage)
	router.GET("/reports/time", s.appPage)
	router.GET("/ws/chat", s.chatWebSocket)
	router.GET("/ws/live", s.liveWebSocket)

	api := router.Group("/api")
	api.POST("/auth/register", s.register)
	api.POST("/auth/login", s.login)
	api.POST("/auth/refresh", s.refresh)
	api.GET("/auth/google/start", s.googleAuthStart)
	api.GET("/auth/google/callback", s.googleAuthCallback)
	api.POST("/auth/google/verify-2fa", s.googleAuthVerifyTwoFactor)
	api.GET("/platform-settings", s.getPublicPlatformSettings)
	api.GET("/subscriptions/plans", s.listPlans)
	api.GET("/pages/:slug", s.getPublicPage)
	api.GET("/paypal/return", s.payPalCheckoutReturn)
	api.GET("/paypal/cancel", s.payPalCheckoutCancel)
	api.POST("/webhooks/paypal", s.paymentWebhook("paypal"))

	authed := api.Group("")
	authed.Use(middleware.AuthRequired(s.tokens), s.requireActiveUser())
	authed.GET("/users/me", s.me)
	authed.PATCH("/users/me", s.updateMyProfile)
	authed.PATCH("/users/me/company-profile", s.updateMyCompanyProfile)
	authed.PATCH("/users/me/preferences", s.updatePreferences)
	authed.POST("/users/me/password/otp", s.requestPasswordUpdateOTP)
	authed.PATCH("/users/me/password", s.updatePassword)
	authed.POST("/users/me/2fa/setup", s.setupTwoFactor)
	authed.POST("/users/me/2fa/enable", s.enableTwoFactor)
	authed.POST("/users/me/2fa/disable", s.disableTwoFactor)
	authed.GET("/users/me/invitations", s.listMyInvitations)
	authed.DELETE("/users/me/company-access", s.leaveCompany)
	authed.GET("/users/me/notifications", s.listNotifications)
	authed.DELETE("/users/me/notifications", s.deleteMyNotifications)
	authed.POST("/users/me/devices", s.registerPushDevice)
	authed.DELETE("/users/me/devices", s.unregisterPushDevice)
	authed.POST("/users/me/notifications/bin/restore", s.restoreAllMyNotifications)
	authed.DELETE("/users/me/notifications/bin/permanent", s.permanentlyDeleteAllMyNotifications)
	authed.POST("/users/me/notifications/:id/open", s.openMyNotification)
	authed.DELETE("/users/me/notifications/:id", s.deleteMyNotification)
	authed.POST("/users/me/notifications/:id/restore", s.restoreMyNotification)
	authed.DELETE("/users/me/notifications/:id/permanent", s.permanentlyDeleteMyNotification)
	authed.GET("/users/mentions", s.listMentionUsers)
	authed.POST("/uploads", s.uploadFile)
	authed.GET("/inbox/comments", s.listInboxComments)
	authed.GET("/search", s.globalSearch)

	authed.GET("/teams/:id", s.getTeam)
	authed.PATCH("/teams/:id/profile", s.updateTeamProfile)
	authed.GET("/teams/:id/invitations", s.listTeamInvitations)
	authed.POST("/teams/:id/invitations", s.createTeamInvitation)
	authed.DELETE("/teams/:id/invitations/:inviteId", s.cancelTeamInvitation)
	authed.DELETE("/teams/:id/invitations/:inviteId/remove", s.removeTeamInvitation)
	authed.POST("/teams/:id/members", s.addTeamMember)
	authed.PATCH("/teams/:id/members/:userId", s.updateTeamMember)
	authed.DELETE("/teams/:id/members/:userId", s.removeTeamMember)
	authed.POST("/invitations/:id/:action", s.respondInvitation)

	authed.GET("/client-projects", s.listClientProjects)
	authed.POST("/client-projects", s.createClientProject)
	authed.GET("/client-projects/:id", s.getClientProject)
	authed.PATCH("/client-projects/:id", s.updateClientProject)
	authed.DELETE("/client-projects/:id", s.deleteClientProject)
	authed.POST("/client-projects/:id/members", s.addClientProjectMember)
	authed.DELETE("/client-projects/:id/members/:userId", s.removeClientProjectMember)
	authed.POST("/client-projects/:id/documents", s.createClientDocument)
	authed.POST("/client-projects/:id/websites", s.createClientWebsite)
	authed.DELETE("/client-documents/:id", s.deleteClientDocument)
	authed.GET("/client-websites/:id", s.getClientWebsite)
	authed.PATCH("/client-websites/:id", s.updateClientWebsite)
	authed.DELETE("/client-websites/:id", s.deleteClientWebsite)
	authed.POST("/client-websites/:id/members", s.addClientWebsiteMember)
	authed.DELETE("/client-websites/:id/members/:userId", s.removeClientWebsiteMember)
	authed.POST("/client-websites/:id/tabs", s.createClientTab)
	authed.PATCH("/client-tabs/:id", s.updateClientTab)
	authed.PATCH("/client-tabs/:id/statuses/:status", s.updateClientTabStatus)
	authed.DELETE("/client-tabs/:id/statuses/:status", s.deleteClientTabStatus)
	authed.DELETE("/client-tabs/:id", s.deleteClientTab)
	authed.POST("/client-tabs/:id/tasks", s.createClientTask)
	authed.GET("/client-tasks/assigned", s.listAssignedClientTasks)
	authed.GET("/client-tasks/export.json", s.exportClientTasksJSON)
	authed.POST("/client-tasks/import", s.importClientTasks)
	authed.GET("/client-tasks/:id", s.getClientTask)
	authed.PATCH("/client-tasks/:id", s.updateClientTask)
	authed.DELETE("/client-tasks/:id", s.deleteClientTask)
	authed.PATCH("/client-tasks/:id/annotations/:annotation_id/status", s.updateClientTaskAnnotationStatus)
	authed.POST("/client-tasks/:id/comments", s.createClientTaskComment)
	authed.POST("/client-task-comments/:id/reactions", s.toggleClientTaskCommentReaction)
	authed.POST("/client-task-comments/:id/read", s.markClientTaskCommentRead)
	authed.PATCH("/client-task-comments/:id", s.updateClientTaskComment)
	authed.DELETE("/client-task-comments/:id", s.deleteClientTaskComment)

	authed.GET("/spaces/:teamId", s.listSpaces)
	authed.POST("/spaces", middleware.RequireRoles(models.RoleTeamAdmin), s.createSpace)
	authed.POST("/projects", middleware.RequireRoles(models.RoleTeamAdmin), s.createProject)
	authed.GET("/projects/:id/lists", s.listProjectLists)
	authed.POST("/lists", middleware.RequireRoles(models.RoleTeamAdmin), s.createList)
	authed.GET("/tasks", s.listTasks)
	authed.POST("/tasks", s.createTask)
	authed.GET("/tasks/:id", s.getTask)
	authed.PATCH("/tasks/:id", s.updateTask)
	authed.POST("/tasks/:id/comments", s.addTaskComment)
	authed.POST("/tasks/:id/comments/:commentId/read", s.markTaskCommentRead)
	authed.DELETE("/tasks/:id", middleware.RequireRoles(models.RoleTeamAdmin), s.deleteTask)

	authed.GET("/websites", s.listWebsites)
	authed.GET("/websites/:id", s.getWebsite)
	authed.POST("/websites", middleware.RequireRoles(models.RoleTeamAdmin), s.createWebsite)
	authed.GET("/websites/:id/bugs", s.listBugs)
	authed.POST("/bugs", s.createBug)
	authed.PATCH("/bugs/:id", s.updateBug)
	authed.POST("/bugs/:id/convert-to-task", s.convertBugToTask)

	authed.POST("/subscriptions/purchase", middleware.RequireRoles(models.RoleTeamAdmin), s.purchaseSubscription)
	authed.GET("/subscriptions/:teamId/invoices", s.listInvoices)

	authed.GET("/integrations", middleware.RequireRoles(models.RoleTeamAdmin), s.listIntegrations)
	authed.POST("/integrations/:provider/connect", middleware.RequireRoles(models.RoleTeamAdmin), s.connectIntegration)
	authed.GET("/integrations/:provider/callback", middleware.RequireRoles(models.RoleTeamAdmin), s.integrationCallback)
	authed.DELETE("/integrations/:provider", middleware.RequireRoles(models.RoleTeamAdmin), s.disconnectIntegration)
	authed.GET("/integrations/:provider/projects", middleware.RequireRoles(models.RoleTeamAdmin), s.integrationProjects)
	authed.POST("/import/:provider", middleware.RequireRoles(models.RoleTeamAdmin), s.startImport)
	authed.GET("/import/jobs/:id", s.getImportJob)
	authed.POST("/export/:provider", middleware.RequireRoles(models.RoleTeamAdmin), s.startExport)
	authed.GET("/export/jobs/:id", s.getExportJob)

	authed.POST("/chats", s.createChat)
	authed.GET("/chats", s.listChats)
	authed.GET("/chats/:id/messages", s.chatMessages)
	authed.POST("/chats/:id/end", s.endChat)
	authed.DELETE("/chats/:id", s.deleteChat)
	authed.POST("/chats/:id/restore", s.restoreChat)
	authed.DELETE("/chats/:id/permanent", s.permanentlyDeleteChat)

	authed.POST("/time-entries/start", s.startTimer)
	authed.POST("/time-entries/:id/stop", s.stopTimer)
	authed.GET("/time-entries/active", s.activeTimer)
	authed.POST("/time-entries", s.createManualTimeEntry)
	authed.GET("/time-entries", s.listTimeEntries)
	authed.PATCH("/time-entries/:id", s.updateTimeEntry)
	authed.DELETE("/time-entries/:id", s.deleteTimeEntry)
	authed.GET("/reports/time", s.timeReport)
	authed.GET("/reports/time/export", s.timeReportCSV)
	authed.GET("/reports/tasks/preview", s.taskReportPreview)
	authed.GET("/reports/tasks/export.pdf", s.taskReportPDF)
	authed.GET("/team/performance", s.teamPerformance)

	owner := authed.Group("/admin")
	owner.Use(middleware.RequireRoles(models.RoleOwnerAdmin))
	owner.GET("/users", s.adminUsers)
	owner.POST("/users", s.adminCreateUser)
	owner.GET("/users/:id", s.adminUserDetails)
	owner.POST("/users/:id/approve", s.adminApproveUser)
	owner.PATCH("/users/:id", s.adminUpdateUser)
	owner.PATCH("/users/:id/membership", s.adminSetUserMembership)
	owner.DELETE("/users/:id", s.adminRemoveUser)
	owner.POST("/users/:id/message", s.adminMessageUser)
	owner.POST("/subscriptions/:id/approve", s.approveSubscription)
	owner.GET("/plans", s.listPlans)
	owner.PATCH("/plans/:id", s.adminUpdatePlan)
	owner.POST("/emails/send", s.sendAdminEmail)
	owner.GET("/settings", s.getSettings)
	owner.PUT("/settings", s.updateSettings)
	owner.POST("/settings/smtp/test", s.testSMTPEmail)
	owner.GET("/pages", s.adminPages)
	owner.POST("/pages", s.createPage)
	owner.PUT("/pages/nav", s.savePublicNav)
	owner.GET("/pages/:slug", s.getPage)
	owner.PUT("/pages/:slug", s.savePageDraft)
	owner.POST("/pages/:slug/publish", s.publishPage)
	owner.GET("/pages/:slug/versions", s.pageVersions)
	owner.POST("/pages/:slug/restore/:versionId", s.restorePageVersion)

	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		s.appPage(c)
	})

	return router
}

func (s *Server) securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Next()
	}
}

type publicPlanCard struct {
	Name        string
	Description string
	PriceLine   string
	YearlyLine  string
	LimitsLine  string
	TrialLine   string
	Featured    bool
}

func (s *Server) homePage(c *gin.Context) {
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	if c.Request.URL.Path == "/" {
		var page models.StaticPage
		if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": "home", "status": "published"}).Decode(&page); err == nil && strings.TrimSpace(page.RenderedHTMLCache) != "" {
			pageHTML, renderCtx := s.renderStaticPageHTML(c.Request.Context(), page)
			c.HTML(http.StatusOK, "legal.gohtml", s.withPublicPageChrome(renderCtx.Settings, gin.H{
				"Title":     page.Title,
				"HTML":      template.HTML(pageHTML),
				"Year":      time.Now().Year(),
				"PageWidth": renderCtx.PageWidth,
			}))
			return
		}
	}
	c.HTML(http.StatusOK, "home.gohtml", s.withPublicPageChrome(settings, gin.H{
		"Year":  time.Now().Year(),
		"Plans": s.publicPlanCards(c.Request.Context()),
	}))
}

func publicVisibleNavItems(items []models.PublicNavItem) []models.PublicNavItem {
	if len(items) == 0 {
		items = defaultPublicNavItems()
	}
	out := []models.PublicNavItem{}
	for _, item := range items {
		if item.Visible && strings.TrimSpace(item.Label) != "" && strings.TrimSpace(item.URL) != "" {
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Order < out[j].Order
	})
	return out
}

func (s *Server) publicPlanCards(ctx context.Context) []publicPlanCard {
	cursor, err := s.store.C("plans").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "price", Value: 1}, {Key: "price_per_seat", Value: 1}, {Key: "name", Value: 1}}))
	if err != nil {
		return fallbackPublicPlanCards()
	}
	defer cursor.Close(ctx)
	plans := []models.Plan{}
	if err := cursor.All(ctx, &plans); err != nil || len(plans) == 0 {
		return fallbackPublicPlanCards()
	}
	cards := make([]publicPlanCard, 0, len(plans))
	for _, plan := range plans {
		cards = append(cards, publicPlanCard{
			Name:        firstNonEmpty(plan.Name, "Plan"),
			Description: plan.Description,
			PriceLine:   publicPlanPriceLine(plan, "monthly"),
			YearlyLine:  publicPlanPriceLine(plan, "yearly"),
			LimitsLine:  publicPlanLimitsLine(plan),
			TrialLine:   publicPlanTrialLine(plan),
			Featured:    plan.Featured,
		})
	}
	return cards
}

func fallbackPublicPlanCards() []publicPlanCard {
	return []publicPlanCard{
		{Name: "Starter", Description: "A focused plan for a small product team validating visual feedback workflows.", PriceLine: "$29 / month", YearlyLine: "$290 / year", LimitsLine: "5 seats - 3 projects - 1 GB storage"},
		{Name: "Team", Description: "More seats, projects, and storage for active delivery teams.", PriceLine: "$9 / seat / month", YearlyLine: "$90 / seat / year", LimitsLine: "25 seats - 15 projects - 10 GB storage", Featured: true},
		{Name: "Business", Description: "Higher limits and owner approval workflows for agencies and larger teams.", PriceLine: "$249 / month", YearlyLine: "$2,490 / year", LimitsLine: "100 seats - 100 projects - 100 GB storage"},
	}
}

func publicPlanPriceLine(plan models.Plan, period string) string {
	perSeat := plan.PricingModel == "per_seat"
	amount := plan.Price
	if perSeat {
		amount = plan.PricePerSeat
	}
	unit := "month"
	if period == "yearly" {
		unit = "year"
		if perSeat {
			amount = plan.PricePerSeatYearly
			if amount <= 0 {
				amount = plan.PricePerSeat * 12
			}
		} else {
			amount = plan.PriceYearly
			if amount <= 0 {
				amount = plan.Price * 12
			}
		}
	}
	if amount <= 0 {
		return "Contact us"
	}
	if perSeat {
		return fmt.Sprintf("%s / seat / %s", formatCentsUSD(amount), unit)
	}
	return fmt.Sprintf("%s / %s", formatCentsUSD(amount), unit)
}

func publicPlanLimitsLine(plan models.Plan) string {
	parts := []string{}
	if plan.SeatLimit > 0 {
		parts = append(parts, fmt.Sprintf("%d seats", plan.SeatLimit))
	}
	if plan.ProjectLimit > 0 {
		parts = append(parts, fmt.Sprintf("%d projects", plan.ProjectLimit))
	}
	if plan.StorageLimitMB > 0 {
		parts = append(parts, formatStorageLimit(plan.StorageLimitMB)+" storage")
	}
	if len(parts) == 0 {
		return "Custom limits"
	}
	return strings.Join(parts, " - ")
}

func publicPlanTrialLine(plan models.Plan) string {
	if plan.TrialDays <= 0 {
		return ""
	}
	if plan.TrialDays == 1 {
		return "1 day free trial"
	}
	return fmt.Sprintf("%d day free trial", plan.TrialDays)
}

func formatCentsUSD(cents int64) string {
	dollars := cents / 100
	remainder := cents % 100
	if remainder == 0 {
		return "$" + formatWholeNumber(dollars)
	}
	return fmt.Sprintf("$%s.%02d", formatWholeNumber(dollars), remainder)
}

func formatWholeNumber(value int64) string {
	raw := fmt.Sprintf("%d", value)
	if len(raw) <= 3 {
		return raw
	}
	out := ""
	for i, r := range raw {
		if i > 0 && (len(raw)-i)%3 == 0 {
			out += ","
		}
		out += string(r)
	}
	return out
}

func formatStorageLimit(megabytes int) string {
	if megabytes >= 1024 && megabytes%1024 == 0 {
		return fmt.Sprintf("%d GB", megabytes/1024)
	}
	if megabytes >= 1024 {
		return fmt.Sprintf("%.1f GB", float64(megabytes)/1024)
	}
	return fmt.Sprintf("%d MB", megabytes)
}

func (s *Server) appPage(c *gin.Context) {
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	c.HTML(http.StatusOK, "app.gohtml", gin.H{"AppName": firstNonEmpty(settings.SiteName, s.cfg.AppName), "FaviconURL": settings.FaviconURL, "Year": time.Now().Year()})
}

func currentUser(c *gin.Context) (middleware.UserContext, bool) {
	return middleware.CurrentUser(c)
}

func (s *Server) requireActiveUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		userCtx, ok := currentUser(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		user, err := s.loadUser(c.Request.Context(), userCtx.ID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
			return
		}
		if user.Status == models.StatusSuspended {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "account is suspended"})
			return
		}
		c.Next()
	}
}

func objectIDParam(c *gin.Context, name string) (primitive.ObjectID, bool) {
	id, err := primitive.ObjectIDFromHex(c.Param(name))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid " + name})
		return primitive.NilObjectID, false
	}
	return id, true
}

func objectIDFromString(value string) (primitive.ObjectID, error) {
	return primitive.ObjectIDFromHex(strings.TrimSpace(value))
}

func parseOptionalDate(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	layouts := []string{time.RFC3339, "2006-01-02"}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return &parsed, nil
		}
	}
	return nil, errors.New("invalid date format")
}

func (s *Server) canAccessTeam(c *gin.Context, teamID primitive.ObjectID) bool {
	user, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return false
	}
	if user.Role == models.RoleOwnerAdmin || user.TeamID == teamID {
		return true
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID, "owner_admin_id": user.ID}).Decode(&team); err == nil {
		return true
	}
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID, "member_ids": user.ID}).Decode(&team); err == nil {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "team access denied"})
	return false
}

func (s *Server) canManageTeam(c *gin.Context, teamID primitive.ObjectID) bool {
	user, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return false
	}
	if user.Role == models.RoleOwnerAdmin || (user.Role == models.RoleTeamAdmin && user.TeamID == teamID) {
		return true
	}
	var team models.Team
	if err := s.store.C("teams").FindOne(c.Request.Context(), bson.M{"_id": teamID, "owner_admin_id": user.ID}).Decode(&team); err == nil {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "only team admins can manage this team"})
	return false
}

func (s *Server) loadUser(ctx context.Context, id primitive.ObjectID) (models.User, error) {
	var user models.User
	err := s.store.C("users").FindOne(ctx, bson.M{"_id": id}).Decode(&user)
	return user, err
}

func (s *Server) audit(ctx context.Context, actorID primitive.ObjectID, action string, targetType string, targetID primitive.ObjectID) {
	_, _ = s.store.C("audit_logs").InsertOne(ctx, models.AuditLog{
		ID:         primitive.NewObjectID(),
		ActorID:    actorID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Timestamp:  time.Now(),
	})
}

func containsObjectID(ids []primitive.ObjectID, id primitive.ObjectID) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

func objectIDsFromStrings(values []string) ([]primitive.ObjectID, error) {
	ids := make([]primitive.ObjectID, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		id, err := primitive.ObjectIDFromHex(strings.TrimSpace(value))
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func stringsOrDefault(values []string, fallback []string) []string {
	if len(values) == 0 {
		return fallback
	}
	return values
}
