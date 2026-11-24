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

	go s.autoProvisionTenantStaticDist(tenant.Subdomain, tenant.ActiveTheme)

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

	// Purge expired soft-deleted stores (>30 days) in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = s.store.PurgeExpiredDeletedTenants(ctx)
	}()

	filter := bson.M{"owner_user_id": user.ID}
	if user.Role == models.RoleOwnerAdmin && c.Query("all") == "true" {
		filter = bson.M{}
	}

	allTenants, err := s.store.ListTenants(c.Request.Context(), filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list stores: " + err.Error()})
		return
	}

	active := make([]models.Tenant, 0)
	deleted := make([]models.Tenant, 0)
	for _, t := range allTenants {
		if t.IsDeleted || t.Status == models.TenantStatusDeleted {
			deleted = append(deleted, t)
		} else {
			active = append(active, t)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"tenants":           active,
		"deleted_tenants":   deleted,
		"is_platform_owner": user.Role == models.RoleOwnerAdmin,
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
	var cfURL string
	if strings.TrimSpace(tenant.CustomDomain) != "" {
		cfURL = fmt.Sprintf("https://%s", strings.TrimSpace(tenant.CustomDomain))
	} else {
		cfURL = fmt.Sprintf("https://%s.bugmega.com", tenant.Subdomain)
	}
	now := time.Now()

	// Load Cloudflare credentials from database first, then fallback to environment
	cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	cfAccount := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	if siteSettings, err := s.loadSiteSettings(c.Request.Context()); err == nil {
		if strings.TrimSpace(siteSettings.CloudflareAPIToken) != "" {
			cfToken = strings.TrimSpace(siteSettings.CloudflareAPIToken)
		}
		if strings.TrimSpace(siteSettings.CloudflareAccountID) != "" {
			cfAccount = strings.TrimSpace(siteSettings.CloudflareAccountID)
		}
	}
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

			// Automatically register the real domain with Cloudflare Pages API
			targetDomain := fmt.Sprintf("%s.bugmega.com", tenant.Subdomain)
			if strings.TrimSpace(tenant.CustomDomain) != "" {
				targetDomain = strings.TrimSpace(tenant.CustomDomain)
			}
			go attachCloudflareCustomDomain(cfToken, cfAccount, cfProject, targetDomain)
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

	targetCNAME := fmt.Sprintf("%s.bugmega.com", tenant.Subdomain)
	c.JSON(http.StatusOK, gin.H{
		"message":              "Custom domain saved. Please configure your DNS CNAME record.",
		"custom_domain":        domain,
		"custom_domain_status": "pending",
		"target_cname":         targetCNAME,
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
		sslStatus := "pending"
		var sslIssuer string
		validTLS, issuer, tlsMsg := verifyDomainTLS(domain)
		if validTLS {
			sslStatus = "active"
			sslIssuer = issuer
		}

		updates := bson.M{
			"custom_domain_status":      "active",
			"custom_domain_verified_at": &now,
			"ssl_status":                sslStatus,
			"cloudflare_url":            fmt.Sprintf("https://%s", domain),
		}
		if validTLS {
			updates["ssl_verified_at"] = &now
			updates["ssl_cert_issuer"] = sslIssuer
			updates["ssl_last_error"] = ""
		} else {
			updates["ssl_last_error"] = tlsMsg
		}
		_ = s.store.UpdateTenant(c.Request.Context(), tenant.ID, updates)

		// Also register with Cloudflare Pages API for SSL provisioning
		cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
		cfAccount := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
		if siteSettings, err := s.loadSiteSettings(c.Request.Context()); err == nil {
			if strings.TrimSpace(siteSettings.CloudflareAPIToken) != "" {
				cfToken = strings.TrimSpace(siteSettings.CloudflareAPIToken)
			}
			if strings.TrimSpace(siteSettings.CloudflareAccountID) != "" {
				cfAccount = strings.TrimSpace(siteSettings.CloudflareAccountID)
			}
		}
		proj := tenant.CloudflareProject
		if proj == "" {
			proj = tenant.Subdomain
		}
		go attachCloudflareCustomDomain(cfToken, cfAccount, proj, domain)

		c.JSON(http.StatusOK, gin.H{
			"verified":   true,
			"status":     "active",
			"ssl_status": sslStatus,
			"ssl_active": validTLS,
			"domain":     domain,
			"cname":      cnameClean,
			"target":     expectedTarget,
			"reason":     reason,
			"message":    "DNS propagation verified! Your custom domain is live.",
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

	updates := bson.M{
		"custom_domain":             "",
		"custom_domain_status":      "",
		"custom_domain_verified_at": nil,
		"ssl_status":                "",
		"ssl_verified_at":          nil,
		"ssl_cert_issuer":           "",
		"ssl_last_error":            "",
		"cloudflare_url":            fmt.Sprintf("https://%s.bugmega.com", tenant.Subdomain),
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
		domain = fmt.Sprintf("%s.bugmega.com", tenant.Subdomain)
	}

	isSubdomain := strings.HasSuffix(domain, ".bugmega.com") || tenant.CustomDomain == ""
	var vpsMsg string

	if isSubdomain {
		// Subdomain is hosted locally on the VPS - run VPS certbot provisioning
		_, vpsMsg = provisionVPSSubdomainSSL(domain)
	} else {
		// External custom domain: Trigger registration with Cloudflare Pages API for Edge SSL
		cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
		cfAccount := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
		if siteSettings, err := s.loadSiteSettings(c.Request.Context()); err == nil {
			if strings.TrimSpace(siteSettings.CloudflareAPIToken) != "" {
				cfToken = strings.TrimSpace(siteSettings.CloudflareAPIToken)
			}
			if strings.TrimSpace(siteSettings.CloudflareAccountID) != "" {
				cfAccount = strings.TrimSpace(siteSettings.CloudflareAccountID)
			}
		}
		proj := tenant.CloudflareProject
		if proj == "" {
			proj = tenant.Subdomain
		}

		if cfToken != "" && cfAccount != "" {
			attachCloudflareCustomDomain(cfToken, cfAccount, proj, domain)
		}
	}

	// 2. Perform live TLS handshake test on domain:443
	validTLS, issuer, tlsMsg := verifyDomainTLS(domain)
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

	var feedbackMsg string
	if isSubdomain {
		feedbackMsg = fmt.Sprintf("VPS SSL check for %s: %s. (%s)", domain, tlsMsg, vpsMsg)
	} else {
		feedbackMsg = fmt.Sprintf("SSL provisioning request sent to Cloudflare Edge for %s. Handshake: %s.", domain, tlsMsg)
	}

	c.JSON(http.StatusOK, gin.H{
		"ssl_active": false,
		"ssl_status": "pending",
		"message":    feedbackMsg,
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

	// Platform Owner can trigger immediate hard/permanent delete via ?hard=true or ?permanent=true
	if c.Query("hard") == "true" || c.Query("permanent") == "true" {
		if user.Role != models.RoleOwnerAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the platform owner can perform permanent deletion"})
			return
		}
		s.performPermanentTenantDelete(c, tenant)
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
		"is_deleted": false,
		"status":     restoreStatus,
		"deleted_at": nil,
		"purge_at":   nil,
		"deleted_by": nil,
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

	if user.Role != models.RoleOwnerAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the platform owner can permanently wipe stores and directory files"})
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

	s.performPermanentTenantDelete(c, tenant)
}

func (s *Server) performPermanentTenantDelete(c *gin.Context, tenant *models.Tenant) {
	ctx := c.Request.Context()

	// 1. Delete associated directories and files from disk
	deletedDirs := make([]string, 0)
	candidateDirs := []string{
		fmt.Sprintf("/var/www/tenants/%s", tenant.Subdomain),
		fmt.Sprintf("/var/www/%s", tenant.Subdomain),
		fmt.Sprintf("/tmp/tenants/%s", tenant.Subdomain),
		fmt.Sprintf("tenants/%s", tenant.Subdomain),
	}
	for _, dir := range candidateDirs {
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			if err := os.RemoveAll(dir); err == nil {
				deletedDirs = append(deletedDirs, dir)
			}
		}
	}

	// 2. Cloudflare API cleanup: delete custom domain and pages project
	cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	cfAccount := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	if siteSettings, err := s.loadSiteSettings(ctx); err == nil {
		if strings.TrimSpace(siteSettings.CloudflareAPIToken) != "" {
			cfToken = strings.TrimSpace(siteSettings.CloudflareAPIToken)
		}
		if strings.TrimSpace(siteSettings.CloudflareAccountID) != "" {
			cfAccount = strings.TrimSpace(siteSettings.CloudflareAccountID)
		}
	}
	proj := tenant.CloudflareProject
	if proj == "" {
		proj = tenant.Subdomain
	}
	go deleteCloudflarePagesProject(cfToken, cfAccount, proj, tenant.CustomDomain)

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

func isAstroEditorAPI(path string) bool {
	p := strings.ToLower(path)
	for _, prefix := range astroEditorAPIPrefixes {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

func isEditorOrBuilderPath(path string) bool {
	p := strings.ToLower(path)
	if p == "/editor" || strings.HasPrefix(p, "/editor/") ||
		strings.Contains(p, "builder") || strings.Contains(p, "edit-") ||
		strings.HasSuffix(p, "-editor") || strings.HasSuffix(p, "-builder") {
		return true
	}
	return false
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
			// 1. Editor and builder HTML routes: require authentication and store ownership!
			if isEditorOrBuilderPath(path) {
				user, ok := s.authenticateUserFromRequest(c)
				if !ok {
					c.Redirect(http.StatusFound, "/login?redirect="+url.QueryEscape(c.Request.RequestURI))
					c.Abort()
					return
				}

				tenantSlug := strings.TrimSpace(c.Query("tenant"))
				if tenantSlug != "" {
					tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), tenantSlug)
					if err == nil && tenant != nil {
						if tenant.OwnerUserID != user.ID && user.Role != models.RoleOwnerAdmin {
							c.String(http.StatusForbidden, "403 Forbidden: You do not have permission to edit this store.")
							c.Abort()
							return
						}
					}
				}

				s.proxyToAstro(c, "http://127.0.0.1:4321", path)
				c.Abort()
				return
			}

			// 2. Editor static assets & editor API endpoints on bugmega.com: proxy to Astro
			if strings.HasPrefix(path, "/editor-") || strings.HasPrefix(path, "/_astro/") ||
				strings.HasPrefix(path, "/public/editor-") || isAstroEditorAPI(path) {
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
		if strings.HasSuffix(host, "."+baseDomain) {
			subdomain := strings.TrimSuffix(host, "."+baseDomain)
			if !reservedSubdomains[subdomain] {
				t, err := s.store.GetTenantBySubdomain(c.Request.Context(), subdomain)
				if err == nil && t != nil && !t.IsDeleted && t.Status != models.TenantStatusDeleted {
					tenant = t
				}
			}
		}

		// Or check if it's a custom domain
		if tenant == nil {
			t, err := s.store.GetTenantByCustomDomain(c.Request.Context(), host)
			if err == nil && t != nil && !t.IsDeleted && t.Status != models.TenantStatusDeleted {
				tenant = t
			}
		}

		if tenant == nil {
			// Not a recognized tenant; continue to main platform router
			c.Next()
			return
		}

		// It is a tenant request! Serve the client store
		s.serveTenantWebsite(c, tenant)
		c.Abort()
	}
}

func (s *Server) serveTenantWebsite(c *gin.Context, tenant *models.Tenant) {
	reqPath := c.Request.URL.Path
	if reqPath == "" {
		reqPath = "/"
	}

	// CRITICAL SECURITY: Block all editor and builder routes on the public storefront!
	if isEditorOrBuilderPath(reqPath) || isAstroEditorAPI(reqPath) {
		c.String(http.StatusNotFound, "404 page not found")
		c.Abort()
		return
	}

	// 0. Auto-provision static dist from fastpress_ast if not already created
	s.autoProvisionTenantStaticDist(tenant.Subdomain, tenant.ActiveTheme)

	// 1. Check if tenant static dist directory exists on disk
	candidateDirs := []string{
		fmt.Sprintf("/var/www/tenants/%s/dist", tenant.Subdomain),
		fmt.Sprintf("/var/www/tenants/%s", tenant.Subdomain),
		fmt.Sprintf("tenants/%s/dist", tenant.Subdomain),
	}

	for _, distDir := range candidateDirs {
		if fi, err := os.Stat(distDir); err == nil && fi.IsDir() {
			cleanSubPath := strings.TrimPrefix(filepath.Clean(reqPath), "/")
			if cleanSubPath != "" && cleanSubPath != "." {
				targetFile := filepath.Join(distDir, cleanSubPath)
				if info, err := os.Stat(targetFile); err == nil && !info.IsDir() {
					c.File(targetFile)
					return
				}
			}
			indexFile := filepath.Join(distDir, "index.html")
			if _, err := os.Stat(indexFile); err == nil {
				c.File(indexFile)
				return
			}
		}
	}

	// 2. Ensure Astro SSR server is running on port 4321
	if !isPortOpen("127.0.0.1:4321") {
		s.ensureAstroRunning()
	}

	astroURL := "http://127.0.0.1:4321"
	if isPortOpen("127.0.0.1:4321") {
		theme := tenant.ActiveTheme
		if theme == "" {
			theme = "furnisite"
		}

		astroPath := reqPath
		if strings.HasPrefix(reqPath, "/_astro") || strings.HasPrefix(reqPath, "/images") || strings.HasPrefix(reqPath, "/css") || strings.HasPrefix(reqPath, "/js") || strings.HasPrefix(reqPath, "/favicon") {
			astroPath = reqPath
		} else if reqPath == "/" {
			astroPath = fmt.Sprintf("/preview/%s", theme)
		} else if !strings.HasPrefix(reqPath, "/preview") {
			astroPath = fmt.Sprintf("/preview/%s%s", theme, reqPath)
		}

		s.proxyToAstro(c, astroURL, astroPath)
		return
	}

	// 3. Fallback: render store landing with theme info
	c.Header("Content-Type", "text/html; charset=utf-8")
	themeName := tenant.ActiveTheme
	if themeName == "" {
		themeName = "furnisite"
	}
	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s | Storefront</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f8fafc; color: #1e293b; text-align: center; }
    .card { max-width: 640px; margin: 60px auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    h1 { margin: 0 0 10px 0; color: #0f172a; font-size: 2rem; }
    p { color: #64748b; font-size: 1.05rem; line-height: 1.6; margin: 8px 0; }
    .badge { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; margin-bottom: 20px; }
    .info-box { background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: left; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Theme: %s</div>
    <h1>%s</h1>
    <p>Welcome to our storefront! The store is provisioned and ready.</p>
    <div class="info-box">
      <strong>Store Details:</strong><br>
      • Subdomain: <code>%s.bugmega.com</code><br>
      • Active Theme: <code>%s</code><br>
      • Status: <code>%s</code>
    </div>
    <p><small style="color:#94a3b8;">Click "Publish" in the Website Builder or start the Astro service on port 4321 to render the live storefront.</small></p>
  </div>
</body>
</html>`, template.HTMLEscapeString(tenant.CompanyName), template.HTMLEscapeString(themeName), template.HTMLEscapeString(tenant.CompanyName), template.HTMLEscapeString(tenant.Subdomain), template.HTMLEscapeString(themeName), template.HTMLEscapeString(string(tenant.Status)))

	c.String(http.StatusOK, html)
}

func (s *Server) proxyToAstro(c *gin.Context, targetURL, rewritePath string) {
	target, err := url.Parse(targetURL)
	if err != nil {
		c.String(http.StatusBadGateway, "invalid proxy target")
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", c.Request.Host)
		req.Header.Set("X-Forwarded-Proto", "https")
		if tenant := c.Query("tenant"); tenant != "" {
			req.Header.Set("X-Tenant-Subdomain", tenant)
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
