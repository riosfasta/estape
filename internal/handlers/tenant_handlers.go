package handlers

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"bugmark/internal/middleware"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

var validSubdomainRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]{1,28}[a-z0-9]$`)
var validDomainRegex = regexp.MustCompile(`^([a-zA-Z0-9]+(-[a-zA-Z0-9]+)*\.)+[a-zA-Z]{2,}$`)

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

	// Enforce maximum 3 subdomain websites per user (active + soft-deleted in Trash; client-unlisted websites free the slot)
	if user.Role != models.RoleOwnerAdmin {
		owned, err := s.store.ListTenantsByOwner(c.Request.Context(), user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check website quota: " + err.Error()})
			return
		}
		activeOrTrashCount := 0
		for _, t := range owned {
			if !t.ClientHidden {
				activeOrTrashCount++
			}
		}
		if activeOrTrashCount >= MaxWebsitesPerUser {
			c.JSON(http.StatusForbidden, gin.H{
				"error":         fmt.Sprintf("Website limit reached: you can create up to %d websites per account (including deleted websites in Trash).", MaxWebsitesPerUser),
				"website_count": activeOrTrashCount,
				"max_websites":  MaxWebsitesPerUser,
			})
			return
		}
	}

	// Check if already taken
	existing, err := s.store.GetTenantBySubdomain(c.Request.Context(), slug)
	if err == nil && existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "subdomain is already taken"})
		return
	}

	requestedTheme := strings.ToLower(strings.TrimSpace(req.ActiveTheme))
	if requestedTheme == "" {
		requestedTheme = "default"
	}
	activeTheme := requestedTheme
	marketThemeSlug := requestedTheme
	marketThemeName := ""
	if s.store != nil {
		if marketTheme, tErr := s.store.GetWebsiteThemeBySlug(c.Request.Context(), requestedTheme); tErr == nil && marketTheme != nil && marketTheme.IsActive {
			activeTheme = sanitizeBaseTheme(marketTheme.BaseTheme)
			marketThemeSlug = marketTheme.Slug
			marketThemeName = marketTheme.Name
		} else if activeTheme != "furnisite" && activeTheme != "default" {
			activeTheme = "default"
			marketThemeSlug = "default"
		}
	} else if activeTheme != "furnisite" && activeTheme != "default" {
		activeTheme = "default"
		marketThemeSlug = "default"
	}

	companyName := strings.TrimSpace(req.CompanyName)
	if companyName == "" {
		companyName = strings.ToUpper(slug[:1]) + slug[1:]
	}

	tenant := models.Tenant{
		OwnerUserID:     user.ID,
		Subdomain:       slug,
		CompanyName:     companyName,
		ActiveTheme:     activeTheme,
		MarketThemeSlug: marketThemeSlug,
		MarketThemeName: marketThemeName,
		Status:          models.TenantStatusDraft,
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

	go s.ensureTenantDevDirectory(tenant.Subdomain, tenant.ActiveTheme)

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
	ctx := c.Request.Context()
	pag := s.parseListPagination(c)

	// Purge expired soft-deleted stores (>30 days) in background
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = s.store.PurgeExpiredDeletedTenants(bgCtx)
	}()

	baseFilter := bson.M{
		"client_hidden": bson.M{"$ne": true},
	}
	if !(user.Role == models.RoleOwnerAdmin && c.Query("all") == "true") {
		baseFilter["owner_user_id"] = user.ID
	}

	deletedCond := bson.M{"$or": []bson.M{
		{"is_deleted": true},
		{"status": models.TenantStatusDeleted},
	}}
	activeCond := bson.M{
		"is_deleted": bson.M{"$ne": true},
		"status":     bson.M{"$ne": models.TenantStatusDeleted},
	}

	activeBaseFilter := bson.M{"$and": []bson.M{baseFilter, activeCond}}
	trashBaseFilter := bson.M{"$and": []bson.M{baseFilter, deletedCond}}

	activeTotal, _ := s.store.CountTenants(ctx, activeBaseFilter)
	trashTotal, _ := s.store.CountTenants(ctx, trashBaseFilter)

	totalOwned := int(activeTotal + trashTotal)
	remainingWebsites := MaxWebsitesPerUser - totalOwned
	if remainingWebsites < 0 {
		remainingWebsites = 0
	}

	q := strings.TrimSpace(c.Query("q"))
	activeQueryFilter := activeBaseFilter
	trashQueryFilter := trashBaseFilter
	if q != "" {
		pat := regexp.QuoteMeta(q)
		searchCond := bson.M{"$or": []bson.M{
			{"company_name": bson.M{"$regex": pat, "$options": "i"}},
			{"subdomain": bson.M{"$regex": pat, "$options": "i"}},
			{"custom_domain": bson.M{"$regex": pat, "$options": "i"}},
		}}
		activeQueryFilter = bson.M{"$and": []bson.M{activeBaseFilter, searchCond}}
		trashQueryFilter = bson.M{"$and": []bson.M{trashBaseFilter, searchCond}}
	}

	activeFilteredTotal := activeTotal
	trashFilteredTotal := trashTotal
	if q != "" {
		activeFilteredTotal, _ = s.store.CountTenants(ctx, activeQueryFilter)
		trashFilteredTotal, _ = s.store.CountTenants(ctx, trashQueryFilter)
	}

	tab := strings.ToLower(strings.TrimSpace(c.Query("tab")))
	activePage := 1
	trashPage := 1
	if tab == "trash" {
		trashPage = pag.Page
	} else {
		activePage = pag.Page
	}

	activeMeta := buildPaginationMeta(activePage, pag.Limit, activeFilteredTotal)
	trashMeta := buildPaginationMeta(trashPage, pag.Limit, trashFilteredTotal)

	sortOrder := bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}
	active, err := s.store.ListTenantsPaginated(ctx, activeQueryFilter, sortOrder, int64((activeMeta.Page-1)*activeMeta.Limit), int64(activeMeta.Limit))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list stores: " + err.Error()})
		return
	}
	deleted, err := s.store.ListTenantsPaginated(ctx, trashQueryFilter, sortOrder, int64((trashMeta.Page-1)*trashMeta.Limit), int64(trashMeta.Limit))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list deleted stores: " + err.Error()})
		return
	}

	currentPagination := activeMeta
	if tab == "trash" {
		currentPagination = trashMeta
	}

	c.JSON(http.StatusOK, gin.H{
		"tenants":            active,
		"deleted_tenants":    deleted,
		"active_total":       activeTotal,
		"trash_total":        trashTotal,
		"active_pagination":  activeMeta,
		"trash_pagination":   trashMeta,
		"pagination":         currentPagination,
		"default_limit":      pag.DefaultLimit,
		"is_platform_owner":  user.Role == models.RoleOwnerAdmin,
		"website_count":      totalOwned,
		"max_websites":       MaxWebsitesPerUser,
		"remaining_websites": remainingWebsites,
	})
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
		if !strings.EqualFold(custom, strings.TrimSpace(tenant.CustomDomain)) && !s.tenantHasActiveDomainPlan(c.Request.Context(), tenant) {
			monthly, yearly, _ := s.customDomainPricing(c.Request.Context())
			c.JSON(http.StatusPaymentRequired, gin.H{
				"error":            "Connecting a custom domain requires an active Custom Domain plan.",
				"payment_required": true,
				"monthly_cents":    monthly,
				"yearly_cents":     yearly,
			})
			return
		}
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

	pag := s.parseListPagination(c)
	ctx := c.Request.Context()
	total, _ := s.store.C("tenant_form_submissions").CountDocuments(ctx, bson.M{"tenant_id": tenant.ID})
	meta := buildPaginationMeta(pag.Page, pag.Limit, total)
	submissions, err := s.store.ListTenantFormSubmissions(ctx, tenant.ID, int64(meta.Limit))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list submissions: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"submissions":   submissions,
		"pagination":    meta,
		"default_limit": pag.DefaultLimit,
	})
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

	// Plan B (VPS-hosted): publishing pushes the site live to custom domain (clientdomain.com) in isolated published/ directory
	ctx := c.Request.Context()
	customDomain := strings.TrimSpace(tenant.CustomDomain)
	if user.Role != models.RoleOwnerAdmin {
		if !s.tenantHasActiveDomainPlan(ctx, tenant) {
			c.JSON(http.StatusPaymentRequired, gin.H{
				"error": "Active custom domain plan required to publish to clientdomain.com. Your subdomain is already publicly accessible.",
				"code":  "CUSTOM_DOMAIN_PAYMENT_REQUIRED",
			})
			return
		}
		if customDomain == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Connect your custom domain (clientdomain.com) before publishing live. Your subdomain is already publicly accessible.",
				"code":  "CUSTOM_DOMAIN_REQUIRED",
			})
			return
		}
	}

	baseDomain := s.tenantBaseDomain()
	liveURL := fmt.Sprintf("https://%s.%s", tenant.Subdomain, baseDomain)
	if customDomain != "" {
		liveURL = fmt.Sprintf("https://%s", customDomain)
	}
	now := time.Now()

	pubRes, pubErr := s.buildAndPublishTenantStaticSite(ctx, tenant, "")
	if pubErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to publish site to published directory: " + pubErr.Error(),
		})
		return
	}

	if customDomain != "" {
		go s.autoConfigureCustomDomainSSL(tenant.ID, customDomain, tenant.Subdomain)
	}

	updates := bson.M{
		"status":         models.TenantStatusActive,
		"published_at":   now,
		"cloudflare_url": liveURL,
	}

	if err := s.store.UpdateTenant(ctx, tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update publish status: " + err.Error()})
		return
	}

	updated, _ := s.store.GetTenantByID(c.Request.Context(), tenant.ID)
	c.JSON(http.StatusOK, gin.H{
		"message":        "site published successfully",
		"live_url":       liveURL,
		"cloudflare_url": liveURL,
		"published_dir":  pubRes.PublishedDistDir,
		"pages_rendered": pubRes.PagesRendered,
		"tenant":         updated,
	})
}

func attachCloudflareCustomDomain(token, accountID, project, domain string) {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(accountID) == "" || strings.TrimSpace(project) == "" || strings.TrimSpace(domain) == "" {
		return
	}
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s/domains", accountID, project)
	payload, _ := json.Marshal(map[string]string{"name": domain})
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err == nil && resp != nil {
		_ = resp.Body.Close()
	}
}

type SetDomainRequest struct {
	CustomDomain string `json:"custom_domain" binding:"required"`
}

func (s *Server) setTenantCustomDomain(c *gin.Context) {
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

	if !s.tenantHasActiveDomainPlan(c.Request.Context(), tenant) {
		monthly, yearly, _ := s.customDomainPricing(c.Request.Context())
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":            "Connecting a custom domain requires a paid monthly or yearly Custom Domain plan.",
			"payment_required": true,
			"monthly_cents":    monthly,
			"yearly_cents":     yearly,
		})
		return
	}

	var req SetDomainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "custom_domain is required"})
		return
	}

	domain := strings.ToLower(strings.TrimSpace(req.CustomDomain))
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	domain = strings.TrimSpace(domain)

	if !validDomainRegex.MatchString(domain) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain name format (e.g. shop.yourbrand.com or www.yourbrand.com)"})
		return
	}

	// Check if already registered by another store
	existing, err := s.store.GetTenantByCustomDomain(c.Request.Context(), domain)
	if err == nil && existing != nil && existing.ID != tenant.ID {
		c.JSON(http.StatusConflict, gin.H{"error": "domain is already registered to another store"})
		return
	}

	updates := bson.M{
		"custom_domain":             domain,
		"custom_domain_status":      "pending",
		"custom_domain_verified_at": nil,
		"ssl_status":                "pending",
		"ssl_verified_at":          nil,
		"ssl_last_error":            "",
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update domain: " + err.Error()})
		return
	}

	// Prepare Nginx HTTP vhost immediately and auto-configure VPS SSL if DNS already points here
	vhostErr := s.ensureNginxTenantVhost(domain)
	go s.autoConfigureCustomDomainSSL(tenant.ID, domain, tenant.Subdomain)

	targetCNAME := fmt.Sprintf("%s.%s", tenant.Subdomain, s.tenantBaseDomain())
	respMsg := "Custom domain saved and Nginx vhost prepared. Point your DNS CNAME record; SSL will be configured automatically on the VPS."
	if vhostErr != nil && !s.disableSystemNginx {
		respMsg = fmt.Sprintf("Custom domain saved. Note: VPS Nginx vhost setup reported: %v", vhostErr)
	}
	c.JSON(http.StatusOK, gin.H{
		"message":              respMsg,
		"custom_domain":        domain,
		"custom_domain_status": "pending",
		"target_cname":         targetCNAME,
		"nginx_vhost_ready":    vhostErr == nil,
	})
}

func (s *Server) verifyTenantDomainPropagation(c *gin.Context) {
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

	domain := strings.TrimSpace(tenant.CustomDomain)
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no custom domain is configured for this store"})
		return
	}

	expectedTarget := fmt.Sprintf("%s.bugmega.com", tenant.Subdomain)
	expectedPages := fmt.Sprintf("%s.pages.dev", tenant.Subdomain)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var r net.Resolver
	cname, lookupErr := r.LookupCNAME(ctx, domain)
	cnameClean := strings.TrimSuffix(strings.TrimSpace(strings.ToLower(cname)), ".")

	verified := false
	reason := ""

	if lookupErr == nil && cnameClean != "" {
		if cnameClean == expectedTarget || cnameClean == expectedPages ||
			strings.HasSuffix(cnameClean, expectedTarget) || strings.HasSuffix(cnameClean, expectedPages) {
			verified = true
			reason = fmt.Sprintf("CNAME successfully points to %s", cnameClean)
		}
	}

	// Fallback check: check if IP lookup succeeds and matches target host IPs (common with CNAME flattening)
	if !verified {
		targetIPs, _ := r.LookupHost(ctx, expectedTarget)
		domainIPs, _ := r.LookupHost(ctx, domain)
		if len(targetIPs) > 0 && len(domainIPs) > 0 {
			targetIPMap := make(map[string]bool)
			for _, ip := range targetIPs {
				targetIPMap[ip] = true
			}
			for _, ip := range domainIPs {
				if targetIPMap[ip] {
					verified = true
					reason = fmt.Sprintf("IP match (%s)", ip)
					break
				}
			}
		}
	}

	now := time.Now()
	if verified {
		// Automatically configure VPS Nginx + Certbot SSL as soon as DNS propagation is verified
		validTLS, issuer, tlsMsg := s.provisionVPSSSLForDomain(domain)
		sslStatus := "pending"
		if validTLS {
			sslStatus = "active"
		}

		updates := bson.M{
			"custom_domain_status":      "active",
			"custom_domain_verified_at": &now,
			"ssl_status":                sslStatus,
			"cloudflare_url":            fmt.Sprintf("https://%s", domain),
		}
		if validTLS {
			updates["ssl_verified_at"] = &now
			updates["ssl_cert_issuer"] = issuer
			updates["ssl_last_error"] = ""
		} else {
			updates["ssl_last_error"] = tlsMsg
		}
		_ = s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates)

		c.JSON(http.StatusOK, gin.H{
			"verified":    true,
			"status":      "active",
			"ssl_status":  sslStatus,
			"ssl_active":  validTLS,
			"ssl_issuer":  issuer,
			"ssl_message": tlsMsg,
			"domain":      domain,
			"cname":       cnameClean,
			"target":      expectedTarget,
			"reason":      reason,
			"message":     "DNS propagation verified! VPS SSL auto-configuration completed.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"verified": false,
		"status":   "pending",
		"domain":   domain,
		"cname":    cnameClean,
		"target":   expectedTarget,
		"message":  fmt.Sprintf("DNS has not propagated yet. Current CNAME: %s (expected %s). DNS updates typically take 2-30 minutes worldwide.", cnameClean, expectedTarget),
	})
}

func (s *Server) removeTenantCustomDomain(c *gin.Context) {
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

	if strings.TrimSpace(tenant.CustomDomain) != "" {
		_ = s.removeNginxTenantVhost(tenant.CustomDomain)
	}

	updates := bson.M{
		"custom_domain":             "",
		"custom_domain_status":      "",
		"custom_domain_verified_at": nil,
		"ssl_status":                "",
		"ssl_verified_at":           nil,
		"ssl_cert_issuer":           "",
		"ssl_last_error":            "",
		"cloudflare_url":            fmt.Sprintf("https://%s.%s", tenant.Subdomain, s.tenantBaseDomain()),
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove domain: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Custom domain removed successfully"})
}

func verifyDomainTLS(domain string) (bool, string, string) {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	tlsConfig := &tls.Config{
		ServerName: domain,
	}
	conn, err := tls.DialWithDialer(dialer, "tcp", domain+":443", tlsConfig)
	if err != nil {
		return false, "", err.Error()
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return false, "", "no peer certificates found in TLS handshake"
	}
	cert := state.PeerCertificates[0]
	now := time.Now()
	if now.Before(cert.NotBefore) {
		return false, cert.Issuer.CommonName, fmt.Sprintf("certificate is not valid until %s", cert.NotBefore.Format("2006-01-02"))
	}
	if now.After(cert.NotAfter) {
		return false, cert.Issuer.CommonName, fmt.Sprintf("certificate expired on %s", cert.NotAfter.Format("2006-01-02"))
	}
	return true, cert.Issuer.CommonName, fmt.Sprintf("Valid SSL certificate issued by %s (expires %s)", cert.Issuer.CommonName, cert.NotAfter.Format("2006-01-02"))
}

func provisionVPSSubdomainSSL(domain string) (bool, string) {
	certbotPath, err := exec.LookPath("certbot")
	if err != nil {
		return false, "certbot CLI is not installed on this VPS"
	}

	cmd := exec.Command(certbotPath, "certonly", "--nginx", "-d", domain, "--non-interactive", "--agree-tos", "--register-unsafely-without-email")
	out, err := cmd.CombinedOutput()
	if err != nil {
		cmdWebroot := exec.Command(certbotPath, "certonly", "--webroot", "-w", "/var/www/html", "-d", domain, "--non-interactive", "--agree-tos", "--register-unsafely-without-email")
		outWebroot, errW := cmdWebroot.CombinedOutput()
		if errW != nil {
			return false, fmt.Sprintf("certbot error: %s (webroot: %s)", strings.TrimSpace(string(out)), strings.TrimSpace(string(outWebroot)))
		}
	}

	if nginxPath, err := exec.LookPath("nginx"); err == nil {
		_ = exec.Command(nginxPath, "-s", "reload").Run()
	} else if sysctl, err := exec.LookPath("systemctl"); err == nil {
		_ = exec.Command(sysctl, "reload", "nginx").Run()
	}

	return true, "SSL certificate provisioned on VPS and Nginx reloaded"
}

func (s *Server) provisionTenantSSL(c *gin.Context) {
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

	domain := strings.TrimSpace(tenant.CustomDomain)
	if domain == "" {
		domain = fmt.Sprintf("%s.%s", tenant.Subdomain, s.tenantBaseDomain())
	}

	// Provision & verify SSL directly on the VPS via Nginx + Certbot (or wildcard cert for *.bugmega.com)
	validTLS, issuer, tlsMsg := s.provisionVPSSSLForDomain(domain)
	now := time.Now()

	if validTLS {
		updates := bson.M{
			"ssl_status":      "active",
			"ssl_verified_at": &now,
			"ssl_cert_issuer": issuer,
			"ssl_last_error":  "",
		}
		_ = s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates)
		c.JSON(http.StatusOK, gin.H{
			"ssl_active": true,
			"ssl_status": "active",
			"issuer":     issuer,
			"message":    tlsMsg,
			"domain":     domain,
		})
		return
	}

	// TLS dial not yet valid
	updates := bson.M{
		"ssl_status":     "pending",
		"ssl_last_error": tlsMsg,
	}
	_ = s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates)

	c.JSON(http.StatusOK, gin.H{
		"ssl_active": false,
		"ssl_status": "pending",
		"message":    fmt.Sprintf("VPS SSL provisioning status for %s: %s", domain, tlsMsg),
		"domain":     domain,
	})
}

func (s *Server) getTenantSSLStatus(c *gin.Context) {
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

	domain := strings.TrimSpace(tenant.CustomDomain)
	if domain == "" {
		domain = fmt.Sprintf("%s.bugmega.com", tenant.Subdomain)
	}

	validTLS, issuer, tlsMsg := verifyDomainTLS(domain)
	status := tenant.SSLStatus
	if status == "" {
		status = "pending"
	}
	if validTLS {
		status = "active"
		now := time.Now()
		_ = s.store.UpdateTenant(c.Request.Context(), tenant.ID, bson.M{
			"ssl_status":      "active",
			"ssl_verified_at": &now,
			"ssl_cert_issuer": issuer,
			"ssl_last_error":  "",
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ssl_active": validTLS,
		"ssl_status": status,
		"issuer":     issuer,
		"message":    tlsMsg,
		"domain":     domain,
	})
}

func (s *Server) deleteTenant(c *gin.Context) {
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
		c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// Only Platform Owner performs actual permanent deletion; store owners unlist the website from the client end
	// while keeping it in the Platform Owner retention archive (/admin/deleted-projects).
	if c.Query("hard") == "true" || c.Query("permanent") == "true" {
		if user.Role == models.RoleOwnerAdmin {
			s.performPermanentTenantDelete(c, tenant)
			return
		}
		if tenant.OwnerUserID != user.ID {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		s.unlistTenantForClient(c, tenant, user.ID)
		return
	}

	// Soft delete with 30-day (1 month) retention
	now := time.Now()
	purgeAt := now.Add(30 * 24 * time.Hour)
	updates := bson.M{
		"is_deleted": true,
		"status":     models.TenantStatusDeleted,
		"deleted_at": &now,
		"purge_at":   &purgeAt,
		"deleted_by": &user.ID,
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete store: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Store moved to Trash. It can be restored within 30 days before permanent deletion.",
		"deleted":  true,
		"purge_at": purgeAt,
	})
}

func (s *Server) restoreTenant(c *gin.Context) {
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
		c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	restoreStatus := models.TenantStatusActive
	if tenant.PublishedAt == nil {
		restoreStatus = models.TenantStatusDraft
	}

	updates := bson.M{
		"is_deleted":         false,
		"status":             restoreStatus,
		"deleted_at":         nil,
		"purge_at":           nil,
		"deleted_by":         nil,
		"client_hidden":      false,
		"client_unlisted_at": nil,
	}

	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restore store: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Store restored successfully!",
		"tenant":  tenant,
	})
}

func (s *Server) permanentDeleteTenant(c *gin.Context) {
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
		c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
		return
	}

	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if user.Role == models.RoleOwnerAdmin {
		s.performPermanentTenantDelete(c, tenant)
		return
	}
	s.unlistTenantForClient(c, tenant, user.ID)
}

func (s *Server) unlistTenant(c *gin.Context) {
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
		c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
		return
	}
	if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	s.unlistTenantForClient(c, tenant, user.ID)
}

func (s *Server) unlistTenantForClient(c *gin.Context, tenant *models.Tenant, actorID primitive.ObjectID) {
	now := time.Now()
	deletedAt := now
	if tenant.DeletedAt != nil {
		deletedAt = *tenant.DeletedAt
	}
	purgeAt := deletedAt.Add(30 * 24 * time.Hour)
	if tenant.PurgeAt != nil {
		purgeAt = *tenant.PurgeAt
	}
	updates := bson.M{
		"is_deleted":         true,
		"status":             models.TenantStatusDeleted,
		"deleted_at":         &deletedAt,
		"purge_at":           &purgeAt,
		"deleted_by":         &actorID,
		"client_hidden":      true,
		"client_unlisted_at": &now,
	}
	if err := s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove website: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":  "Website removed from your account and archived under platform retention.",
		"unlisted": true,
		"deleted":  true,
		"purge_at": purgeAt,
	})
}

func (s *Server) performPermanentTenantDelete(c *gin.Context, tenant *models.Tenant) {
	ctx := c.Request.Context()

	// 1. Delete associated directories and files from disk (dev + published)
	deletedDirs := make([]string, 0)
	candidateDirs := []string{
		s.tenantRootDir(tenant.Subdomain),
		fmt.Sprintf("/var/www/tenants/%s", tenant.Subdomain),
		fmt.Sprintf("/var/www/%s", tenant.Subdomain),
		fmt.Sprintf("/tmp/tenants/%s", tenant.Subdomain),
		fmt.Sprintf("tenants/%s", tenant.Subdomain),
	}
	seenDir := map[string]bool{}
	for _, dir := range candidateDirs {
		if seenDir[dir] {
			continue
		}
		seenDir[dir] = true
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			if err := os.RemoveAll(dir); err == nil {
				deletedDirs = append(deletedDirs, dir)
			}
		}
	}

	// 2. Clean up VPS Nginx vhost & SSL cert if custom domain was configured
	if strings.TrimSpace(tenant.CustomDomain) != "" {
		_ = s.removeNginxTenantVhost(tenant.CustomDomain)
	}

	// 3. Delete database records: form submissions, store customers, and tenant record
	if err := s.store.PurgeTenantData(ctx, tenant.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to purge database records: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Store and all associated directory files, database records, and subdomain settings permanently purged.",
		"deleted_dirs": deletedDirs,
		"subdomain":    tenant.Subdomain,
		"purged":       true,
	})
}

func deleteCloudflarePagesProject(token, accountID, project, customDomain string) {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(accountID) == "" || strings.TrimSpace(project) == "" {
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}

	// Detach custom domain first if present
	if strings.TrimSpace(customDomain) != "" {
		domainURL := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s/domains/%s", accountID, project, customDomain)
		req, err := http.NewRequest(http.MethodDelete, domainURL, nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			if resp, err := client.Do(req); err == nil && resp != nil {
				_ = resp.Body.Close()
			}
		}
	}

	// Delete pages project to release subdomain
	projURL := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s", accountID, project)
	req, err := http.NewRequest(http.MethodDelete, projURL, nil)
	if err == nil {
		req.Header.Set("Authorization", "Bearer "+token)
		if resp, err := client.Do(req); err == nil && resp != nil {
			_ = resp.Body.Close()
		}
	}
}

var astroEditorAPIPrefixes = []string{
	"/api/forms",
	"/api/pages",
	"/api/site-config",
	"/api/fonts",
	"/api/blog-layouts",
	"/api/categories",
	"/api/custom-code",
	"/api/footers",
	"/api/headers",
	"/api/menus",
	"/api/page-custom-code",
	"/api/popups",
	"/api/posts",
	"/api/product-categories",
	"/api/product-layouts",
	"/api/products",
	"/api/robots",
	"/api/save-page",
	"/api/templates",
	"/api/themes",
	"/api/upload",
}

func isPublicTenantFormSubmit(c *gin.Context, path string) bool {
	if c == nil || c.Request == nil {
		return false
	}
	clean := strings.TrimRight(strings.ToLower(strings.TrimSpace(path)), "/")
	return c.Request.Method == http.MethodPost && clean == "/api/forms/submit"
}

func isAstroEditorAPI(path string) bool {
	p := strings.ToLower(path)
	for _, prefix := range astroEditorAPIPrefixes {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

func isAstroEditorAsset(path string) bool {
	p := strings.ToLower(path)
	if strings.HasPrefix(p, "/_astro/") ||
		strings.HasPrefix(p, "/editor-") ||
		strings.HasPrefix(p, "/public/editor-") ||
		strings.HasPrefix(p, "/themes/") ||
		strings.HasPrefix(p, "/fonts/") ||
		strings.HasPrefix(p, "/uploads/") ||
		p == "/nav-menu.js" || p == "/nav-menu.css" ||
		p == "/products-loop.js" || p == "/products-loop.css" ||
		p == "/header.css" || p == "/favicon.svg" || p == "/favicon.ico" {
		return true
	}
	return false
}

func isEditorOrBuilderPath(path string) bool {
	p := strings.ToLower(path)
	if p == "/editor" || strings.HasPrefix(p, "/editor/") ||
		p == "/preview" || strings.HasPrefix(p, "/preview/") ||
		strings.Contains(p, "builder") || strings.Contains(p, "edit-") ||
		strings.HasSuffix(p, "-editor") || strings.HasSuffix(p, "-builder") {
		return true
	}
	return false
}

func isSensitiveEditorAsset(path string) bool {
	p := strings.ToLower(path)
	return strings.HasPrefix(p, "/editor-") || strings.HasPrefix(p, "/public/editor-")
}

func (s *Server) requireAuthenticatedTenantEditorAccess(c *gin.Context, redirectToLogin bool) (*middleware.UserContext, *models.Tenant, bool) {
	user, ok := s.authenticateUserFromRequest(c)
	if !ok {
		if redirectToLogin {
			c.Redirect(http.StatusFound, "/login?redirect="+url.QueryEscape(c.Request.RequestURI))
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		}
		c.Abort()
		return nil, nil, false
	}

	tenantSlug := extractEditorTenantSlug(c)
	if tenantSlug != "" && s.store != nil {
		tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), tenantSlug)
		if err != nil || tenant == nil {
			c.String(http.StatusNotFound, "404 store not found")
			c.Abort()
			return user, nil, false
		}
		if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
			if redirectToLogin {
				c.String(http.StatusForbidden, "403 Forbidden: You do not have permission to edit this store.")
			} else {
				c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: store ownership required"})
			}
			c.Abort()
			return user, nil, false
		}
		return user, tenant, true
	}

	if tenantSlug == "" && user.Role != models.RoleOwnerAdmin {
		if redirectToLogin {
			c.String(http.StatusForbidden, "403 Forbidden: Please open an editor for a store you own.")
		} else {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: tenant selection required"})
		}
		c.Abort()
		return user, nil, false
	}
	return user, nil, true
}

func (s *Server) authenticateUserFromRequest(c *gin.Context) (*middleware.UserContext, bool) {
	if u, ok := middleware.CurrentUser(c); ok {
		return &u, true
	}
	header := strings.TrimSpace(c.GetHeader("Authorization"))
	if header == "" {
		if cookie, err := c.Cookie("access_token"); err == nil {
			header = "Bearer " + cookie
		}
	}
	if header == "" && strings.TrimSpace(c.Query("token")) != "" {
		header = "Bearer " + strings.TrimSpace(c.Query("token"))
	}
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return nil, false
	}
	raw := strings.TrimSpace(header[7:])
	claims, err := s.tokens.ParseAccessToken(raw)
	if err != nil {
		return nil, false
	}
	userID, err := primitive.ObjectIDFromHex(claims.Subject)
	if err != nil {
		return nil, false
	}
	var teamID primitive.ObjectID
	if claims.TeamID != "" {
		teamID, _ = primitive.ObjectIDFromHex(claims.TeamID)
	}
	ctx := middleware.UserContext{ID: userID, Role: models.Role(claims.Role), TeamID: teamID}
	c.Set(middleware.UserContextKey, ctx)
	return &ctx, true
}

func (s *Server) tenantHostMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		host := strings.ToLower(c.Request.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}

		path := c.Request.URL.Path

		baseDomain := "bugmega.com"
		if s.cfg.AppURL != "" {
			clean := strings.TrimPrefix(s.cfg.AppURL, "https://")
			clean = strings.TrimPrefix(clean, "http://")
			clean = strings.TrimSuffix(clean, "/")
			if h, _, err := net.SplitHostPort(clean); err == nil {
				clean = h
			}
			if clean != "" {
				baseDomain = strings.ToLower(clean)
			}
		}

		// Exact matches for the main platform (bugmega.com)
		if host == baseDomain || host == "www."+baseDomain || host == "localhost" || host == "127.0.0.1" {
			// 0. Theme Market live preview (/preview/:theme/...): require authenticated user (no tenant selection required).
			lowerPath := strings.ToLower(path)
			if lowerPath == "/preview" || strings.HasPrefix(lowerPath, "/preview/") {
				user, ok := s.authenticateUserFromRequest(c)
				if !ok {
					c.Redirect(http.StatusFound, "/login?redirect="+url.QueryEscape(c.Request.RequestURI))
					c.Abort()
					return
				}
				if htmlDoc, ok := s.tryRenderUploadedThemePreview(path); ok {
					c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlDoc))
					c.Abort()
					return
				}
				if tenantSlug := extractEditorTenantSlug(c); tenantSlug != "" && s.store != nil {
					if tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), strings.ToLower(tenantSlug)); err == nil && tenant != nil && !tenant.IsDeleted {
						if tenant.OwnerUserID == user.ID || user.Role == models.RoleOwnerAdmin {
							setProxyTenantContext(c, tenant)
							c.Set("proxyTenantMode", "dev")
						}
					}
				}
				if !isPortOpen("127.0.0.1:4321") {
					s.ensureAstroRunning()
				}
				s.proxyToAstro(c, "http://127.0.0.1:4321", path)
				c.Abort()
				return
			}

			// 1. Editor and builder HTML routes: require authentication and store ownership!
			if isEditorOrBuilderPath(path) {
				_, tenant, ok := s.requireAuthenticatedTenantEditorAccess(c, true)
				if !ok {
					return
				}
				if tenant != nil {
					setProxyTenantContext(c, tenant)
				}
				c.Set("proxyTenantMode", "dev")
				s.proxyToAstro(c, "http://127.0.0.1:4321", path)
				c.Abort()
				return
			}

			// 1b. Tenant dev uploads served cleanly while editing in the builder, or platform uploads from s.cfg.UploadDir
			if strings.HasPrefix(strings.ToLower(path), "/uploads/") {
				relUpload := strings.TrimPrefix(filepath.Clean(path), "/uploads/")
				relUpload = strings.TrimPrefix(relUpload, string(filepath.Separator))
				if relUpload != "" && relUpload != "." && !strings.Contains(relUpload, "..") {
					if tenantSlug := extractEditorTenantSlug(c); tenantSlug != "" && validSubdomainRegex.MatchString(strings.ToLower(tenantSlug)) {
						devUpload := filepath.Join(s.tenantDevUploadsDir(tenantSlug), relUpload)
						if info, err := os.Stat(devUpload); err == nil && !info.IsDir() {
							c.File(devUpload)
							c.Abort()
							return
						}
					}
					uploadRoot := strings.TrimSpace(s.cfg.UploadDir)
					if uploadRoot == "" {
						uploadRoot = "uploads"
					}
					platformUpload := filepath.Join(uploadRoot, relUpload)
					if info, err := os.Stat(platformUpload); err == nil && !info.IsDir() {
						c.Next()
						return
					}
				}
			}

			// 2. Editor static scripts and editor APIs on bugmega.com: require authentication & store ownership (except public POST /api/forms/submit)
			if isSensitiveEditorAsset(path) || (isAstroEditorAPI(path) && !isPublicTenantFormSubmit(c, path)) {
				_, tenant, ok := s.requireAuthenticatedTenantEditorAccess(c, false)
				if !ok {
					return
				}
				if tenant != nil {
					setProxyTenantContext(c, tenant)
				}
				c.Set("proxyTenantMode", "dev")
				s.proxyToAstro(c, "http://127.0.0.1:4321", path)
				c.Abort()
				return
			}

			// 3. Remaining Astro storefront assets (fonts, themes, nav-menu, _astro, public form submit)
			if isAstroEditorAsset(path) || isPublicTenantFormSubmit(c, path) {
				if tenantSlug := extractEditorTenantSlug(c); tenantSlug != "" && s.store != nil {
					if tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), tenantSlug); err == nil && tenant != nil {
						setProxyTenantContext(c, tenant)
					}
				}
				c.Set("proxyTenantMode", "dev")
				s.proxyToAstro(c, "http://127.0.0.1:4321", path)
				c.Abort()
				return
			}

			// Normal main platform routing
			c.Next()
			return
		}

		// Builder subdomain legacy redirect: redirect to main domain editor securely
		if host == "builder."+baseDomain {
			target := fmt.Sprintf("https://%s%s", baseDomain, c.Request.RequestURI)
			c.Redirect(http.StatusMovedPermanently, target)
			c.Abort()
			return
		}

		// Check if it's a tenant subdomain: <slug>.<baseDomain>
		var tenant *models.Tenant
		isCustomDomain := false
		if strings.HasSuffix(host, "."+baseDomain) {
			subdomain := strings.TrimSuffix(host, "."+baseDomain)
			if !reservedSubdomains[subdomain] {
				t, err := s.store.GetTenantBySubdomain(c.Request.Context(), subdomain)
				if err == nil && t != nil && !t.IsDeleted && t.Status != models.TenantStatusDeleted {
					tenant = t
				}
			}
		}

		// Or check if it's a custom domain (clientdomain.com)
		if tenant == nil {
			t, err := s.store.GetTenantByCustomDomain(c.Request.Context(), host)
			if err == nil && t != nil && !t.IsDeleted && t.Status != models.TenantStatusDeleted {
				tenant = t
				isCustomDomain = true
			}
		}

		if tenant == nil {
			// Not a recognized tenant; continue to main platform router
			c.Next()
			return
		}

		// It is a tenant request! Serve the client website (public subdomain or published custom domain)
		s.serveTenantWebsite(c, tenant, isCustomDomain)
		c.Abort()
	}
}

func (s *Server) serveTenantWebsite(c *gin.Context, tenant *models.Tenant, isCustomDomain bool) {
	reqPath := c.Request.URL.Path
	if reqPath == "" {
		reqPath = "/"
	}
	lowerPath := strings.ToLower(reqPath)

	// CRITICAL SECURITY: Block all editor, builder, preview, and editor-asset/API routes on BOTH subdomains and custom domains!
	if isEditorOrBuilderPath(reqPath) ||
		(isAstroEditorAPI(reqPath) && !isPublicTenantFormSubmit(c, reqPath)) ||
		strings.HasPrefix(lowerPath, "/preview") ||
		strings.HasPrefix(lowerPath, "/editor-") ||
		strings.HasPrefix(lowerPath, "/public/editor-") ||
		isEditorPublishArtifact(strings.TrimPrefix(lowerPath, "/")) {
		c.String(http.StatusNotFound, "404 page not found")
		c.Abort()
		return
	}

	pubDistDir := s.tenantPublishedDistDir(tenant.Subdomain)
	pubDataDir := s.tenantPublishedDataDir(tenant.Subdomain)
	pubUploadsDir := s.tenantPublishedUploadsDir(tenant.Subdomain)
	devUploadsDir := s.tenantDevUploadsDir(tenant.Subdomain)

	// Serve tenant uploads: custom domains use published/ uploads only; subdomains can also load dev/uploads.
	if strings.HasPrefix(lowerPath, "/uploads/") {
		relUpload := strings.TrimPrefix(filepath.Clean(reqPath), "/uploads/")
		relUpload = strings.TrimPrefix(relUpload, string(filepath.Separator))
		if relUpload != "" && relUpload != "." && !strings.Contains(relUpload, "..") {
			uploadDirs := []string{devUploadsDir, filepath.Join(pubDistDir, "uploads"), pubUploadsDir}
			if isCustomDomain {
				uploadDirs = []string{filepath.Join(pubDistDir, "uploads"), pubUploadsDir}
			}
			for _, dir := range uploadDirs {
				candidate := filepath.Join(dir, relUpload)
				if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
					c.File(candidate)
					return
				}
			}
		}
		c.Status(http.StatusNotFound)
		return
	}

	if !isCustomDomain {
		// Subdomain (<sub >.bugmega.com): immediately accessible by everyone publicly (no Draft placeholder),
		// rendered with X-Tenant-Mode=subdomain (loads dev/data while blocking ALL editor/builder pages & APIs).
		if !isPortOpen("127.0.0.1:4321") {
			s.ensureAstroRunning()
		}
		if isPortOpen("127.0.0.1:4321") {
			setProxyTenantContext(c, tenant)
			c.Set("proxyTenantMode", "subdomain")
			s.proxyToAstro(c, "http://127.0.0.1:4321", reqPath)
			return
		}
		c.String(http.StatusServiceUnavailable, "Website preview service is starting. Please refresh in a moment.")
		return
	}

	// Custom domain (clientdomain.com): require an actual published snapshot! Never serve dev/ editing files.
	_, distErr := os.Stat(pubDistDir)
	_, dataErr := os.Stat(pubDataDir)
	if tenant.PublishedAt == nil && distErr != nil && dataErr != nil {
		c.Header("Content-Type", "text/html; charset=utf-8")
		themeName := tenant.ActiveTheme
		if themeName == "" {
			themeName = "default"
		}
		html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s | Coming Soon</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f8fafc; color: #1e293b; text-align: center; }
    .card { max-width: 640px; margin: 60px auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    h1 { margin: 0 0 10px 0; color: #0f172a; font-size: 2rem; }
    p { color: #64748b; font-size: 1.05rem; line-height: 1.6; margin: 8px 0; }
    .badge { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Theme: %s · Pending Domain Publish</div>
    <h1>%s</h1>
    <p>This custom domain has not been published yet.</p>
    <p><small style="color:#94a3b8;">Owner: click <strong>Publish</strong> in the Website Builder to push your site live to this domain.</small></p>
  </div>
</body>
</html>`, template.HTMLEscapeString(tenant.CompanyName), template.HTMLEscapeString(themeName), template.HTMLEscapeString(tenant.CompanyName))
		c.String(http.StatusOK, html)
		return
	}

	// 1. Serve static files strictly from /var/www/tenants/<subdomain>/published/dist
	if fi, err := os.Stat(pubDistDir); err == nil && fi.IsDir() {
		cleanSubPath := strings.TrimPrefix(filepath.Clean(reqPath), "/")
		if cleanSubPath == "" || cleanSubPath == "." {
			indexFile := filepath.Join(pubDistDir, "index.html")
			if _, err := os.Stat(indexFile); err == nil {
				c.File(indexFile)
				return
			}
		} else if !strings.Contains(cleanSubPath, "..") {
			targetFile := filepath.Join(pubDistDir, cleanSubPath)
			if info, err := os.Stat(targetFile); err == nil {
				if !info.IsDir() {
					c.File(targetFile)
					return
				}
				subIndex := filepath.Join(targetFile, "index.html")
				if _, err := os.Stat(subIndex); err == nil {
					c.File(subIndex)
					return
				}
			}
		}
	}

	// 2. Dynamic storefront fallback (only in published mode, reading strictly from published/data)
	if !isPortOpen("127.0.0.1:4321") {
		s.ensureAstroRunning()
	}
	if isPortOpen("127.0.0.1:4321") {
		setProxyTenantContext(c, tenant)
		c.Set("proxyTenantMode", "published")
		s.proxyToAstro(c, "http://127.0.0.1:4321", reqPath)
		return
	}

	c.String(http.StatusNotFound, "404 page not found")
}

func extractEditorTenantSlug(c *gin.Context) string {
	if tenant := strings.TrimSpace(c.Query("tenant")); tenant != "" {
		return tenant
	}
	if ref := strings.TrimSpace(c.Request.Referer()); ref != "" {
		if u, err := url.Parse(ref); err == nil {
			if tenant := strings.TrimSpace(u.Query().Get("tenant")); tenant != "" {
				return tenant
			}
		}
	}
	return ""
}

func setProxyTenantContext(c *gin.Context, tenant *models.Tenant) {
	if c == nil || tenant == nil {
		return
	}
	c.Set("proxyTenantSubdomain", tenant.Subdomain)
	theme := strings.ToLower(strings.TrimSpace(tenant.ActiveTheme))
	if theme == "" {
		theme = "default"
	}
	c.Set("proxyTenantTheme", theme)
}

func (s *Server) proxyToAstro(c *gin.Context, targetURL, rewritePath string) {
	target, err := url.Parse(targetURL)
	if err != nil {
		c.String(http.StatusBadGateway, "invalid proxy target")
		return
	}

	tenantSub := strings.TrimSpace(c.GetString("proxyTenantSubdomain"))
	if tenantSub == "" {
		tenantSub = strings.TrimSpace(c.Query("tenant"))
	}
	tenantTheme := strings.TrimSpace(c.GetString("proxyTenantTheme"))
	tenantMode := strings.TrimSpace(c.GetString("proxyTenantMode"))

	proxy := httputil.NewSingleHostReverseProxy(target)
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", c.Request.Host)
		req.Header.Set("X-Forwarded-Proto", "https")
		if tenantSub != "" {
			req.Header.Set("X-Tenant-Subdomain", tenantSub)
		}
		if tenantTheme != "" {
			req.Header.Set("X-Tenant-Theme", tenantTheme)
		}
		if tenantMode != "" {
			req.Header.Set("X-Tenant-Mode", tenantMode)
		}
		if rewritePath != "" {
			req.URL.Path = rewritePath
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("Astro store server is not running on port 4321. Please ensure the Astro service is started."))
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

func isPortOpen(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

var (
	astroProcessLock sync.Mutex
	astroStarting    bool
)

func (s *Server) autoProvisionTenantStaticDist(subdomain, theme string) {
	distDir := fmt.Sprintf("/var/www/tenants/%s/dist", subdomain)
	if _, err := os.Stat(distDir); err == nil {
		return
	}

	sourceCandidates := []string{
		"./fastpress_ast/dist/client",
		"./fastpress_ast/dist",
		"fastpress_ast/dist/client",
		"fastpress_ast/dist",
		"/var/www/fastpress_ast/dist/client",
		"/var/www/fastpress_ast/dist",
		"../fastpress_ast/dist/client",
		"../fastpress_ast/dist",
	}

	var sourceDir string
	for _, sc := range sourceCandidates {
		if fi, err := os.Stat(sc); err == nil && fi.IsDir() {
			sourceDir = sc
			break
		}
	}

	if sourceDir == "" {
		return
	}

	_ = os.MkdirAll(filepath.Dir(distDir), 0755)
	_ = exec.Command("cp", "-r", sourceDir, distDir).Run()
}

func (s *Server) ensureAstroRunning() {
	if isPortOpen("127.0.0.1:4321") {
		return
	}
	astroProcessLock.Lock()
	if isPortOpen("127.0.0.1:4321") || astroStarting {
		astroProcessLock.Unlock()
		return
	}
	astroStarting = true
	astroProcessLock.Unlock()

	defer func() {
		astroProcessLock.Lock()
		astroStarting = false
		astroProcessLock.Unlock()
	}()

	candidateDirs := []string{
		"./fastpress_ast",
		"fastpress_ast",
		"/var/www/fastpress_ast",
		"/var/www/html/fastpress_ast",
		"../fastpress_ast",
	}

	var astroDir string
	for _, dir := range candidateDirs {
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			astroDir = dir
			break
		}
	}

	if astroDir == "" {
		return
	}

	entryMjs := filepath.Join(astroDir, "dist", "server", "entry.mjs")
	var cmd *exec.Cmd
	if _, err := os.Stat(entryMjs); err == nil {
		cmd = exec.Command("node", entryMjs)
	} else {
		cmd = exec.Command("npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "4321")
	}
	cmd.Dir = astroDir
	cmd.Env = append(os.Environ(), "PORT=4321", "HOST=127.0.0.1")
	_ = cmd.Start()

	// Wait up to 3 seconds for port 4321 to be available
	for i := 0; i < 15; i++ {
		time.Sleep(200 * time.Millisecond)
		if isPortOpen("127.0.0.1:4321") {
			break
		}
	}
}
