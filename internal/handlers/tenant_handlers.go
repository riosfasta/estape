package handlers

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

var validSubdomainRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$`)

var reservedSubdomains = map[string]bool{
	"www":     true,
	"api":     true,
	"admin":   true,
	"builder": true,
	"app":     true,
	"static":  true,
	"mail":    true,
	"blog":    true,
	"billing": true,
	"support": true,
	"edge":    true,
	"live":    true,
}

type CreateTenantRequest struct {
	Subdomain   string `json:"subdomain" binding:"required"`
	CompanyName string `json:"company_name" binding:"required"`
	ActiveTheme string `json:"active_theme"`
}

type UpdateTenantRequest struct {
	CompanyName   string                     `json:"company_name"`
	ActiveTheme   string                     `json:"active_theme"`
	CustomDomain  string                     `json:"custom_domain"`
	SMTP          *models.TenantSMTPSettings  `json:"smtp"`
	AutoResponder *models.TenantAutoResponder `json:"auto_responder"`
}

func (s *Server) createTenant(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.Subdomain))
	if !validSubdomainRegex.MatchString(slug) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "subdomain must be 3-30 lowercase alphanumeric characters or hyphens"})
		return
	}
	if reservedSubdomains[slug] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this subdomain is reserved"})
		return
	}

	// Check if already taken
	existing, err := s.store.GetTenantBySubdomain(c.Request.Context(), slug)
	if err == nil && existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "subdomain is already taken"})
		return
	}

	activeTheme := strings.ToLower(strings.TrimSpace(req.ActiveTheme))
	if activeTheme == "" {
		activeTheme = "default"
	}

	companyName := strings.TrimSpace(req.CompanyName)
	if companyName == "" {
		companyName = strings.ToUpper(slug[:1]) + slug[1:]
	}

	tenant := models.Tenant{
		OwnerUserID: user.ID,
		Subdomain:   slug,
		CompanyName: companyName,
		ActiveTheme: activeTheme,
		Status:      models.TenantStatusDraft,
		AutoResponder: models.TenantAutoResponder{
			Enabled: true,
			Subject: fmt.Sprintf("Welcome to %s! Thank you for contacting us", companyName),
			Body:    fmt.Sprintf("<p>Hi {name},</p><p>Thank you for reaching out to %s! We have received your message and will be in touch soon.</p>", companyName),
		},
	}

	if err := s.store.CreateTenant(c.Request.Context(), &tenant); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create store: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "store created successfully",
		"tenant":  tenant,
	})
}

func (s *Server) listMyTenants(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenants, err := s.store.ListTenantsByOwner(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list stores: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tenants": tenants})
}

func (s *Server) getTenant(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenantID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}

	tenant, err := s.store.GetTenantByID(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tenant not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tenant": tenant})
}

func (s *Server) updateTenant(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenantID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}

	tenant, err := s.store.GetTenantByID(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tenant not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	var req UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := bson.M{}
	if strings.TrimSpace(req.CompanyName) != "" {
		updates["company_name"] = strings.TrimSpace(req.CompanyName)
	}
	if strings.TrimSpace(req.ActiveTheme) != "" {
		updates["active_theme"] = strings.ToLower(strings.TrimSpace(req.ActiveTheme))
	}
	if req.CustomDomain != "" {
		custom := strings.ToLower(strings.TrimSpace(req.CustomDomain))
		// Check uniqueness
		existing, err := s.store.GetTenantByCustomDomain(c.Request.Context(), custom)
		if err == nil && existing != nil && existing.ID != tenant.ID {
			c.JSON(http.StatusConflict, gin.H{"error": "custom domain is already registered to another store"})
			return
		}
		updates["custom_domain"] = custom
	}
	if req.SMTP != nil {
		updates["smtp"] = req.SMTP
	}
	if req.AutoResponder != nil {
		updates["auto_responder"] = req.AutoResponder
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update tenant: " + err.Error()})
		return
	}

	updated, _ := s.store.GetTenantByID(c.Request.Context(), tenant.ID)
	c.JSON(http.StatusOK, gin.H{
		"message": "store settings updated",
		"tenant":  updated,
	})
}

func (s *Server) listTenantSubmissions(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenantID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}

	tenant, err := s.store.GetTenantByID(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tenant not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	submissions, err := s.store.ListTenantFormSubmissions(c.Request.Context(), tenant.ID, 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list submissions: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"submissions": submissions})
}

func (s *Server) publishTenant(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenantID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}

	tenant, err := s.store.GetTenantByID(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tenant not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// Prepare output and deployment information
	cfProject := tenant.Subdomain
	cfURL := fmt.Sprintf("https://%s.pages.dev", tenant.Subdomain)
	now := time.Now()

	// If Cloudflare token & project directory are configured on the VPS, execute wrangler
	cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	cfAccount := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	distDir := fmt.Sprintf("/var/www/tenants/%s/dist", tenant.Subdomain)

	var deployLog string
	if cfToken != "" && cfAccount != "" {
		if _, err := os.Stat(distDir); err == nil {
			cmdCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
			defer cancel()

			cmd := exec.CommandContext(cmdCtx, "wrangler", "pages", "deploy", distDir,
				"--project-name="+cfProject,
				"--commit-dirty=true")
			cmd.Env = append(os.Environ(),
				"CLOUDFLARE_API_TOKEN="+cfToken,
				"CLOUDFLARE_ACCOUNT_ID="+cfAccount)

			out, err := cmd.CombinedOutput()
			deployLog = string(out)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":  "cloudflare deployment failed: " + err.Error(),
					"output": deployLog,
				})
				return
			}
		}
	}

	updates := bson.M{
		"status":             models.TenantStatusActive,
		"published_at":       now,
		"cloudflare_project": cfProject,
		"cloudflare_url":     cfURL,
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update publish status: " + err.Error()})
		return
	}

	updated, _ := s.store.GetTenantByID(c.Request.Context(), tenant.ID)
	c.JSON(http.StatusOK, gin.H{
		"message":        "site published successfully",
		"cloudflare_url": cfURL,
		"tenant":         updated,
		"deploy_log":     deployLog,
	})
}
