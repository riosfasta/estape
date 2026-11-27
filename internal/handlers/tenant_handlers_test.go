package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
)

func TestTenantSubdomainValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tm := auth.NewTokenManager("test-secret-key-at-least-32-chars-long!")
	s := &Server{
		tokens: tm,
	}

	router := gin.New()
	v1 := router.Group("/api/v1")
	v1.Use(publicCORSMiddleware())
	v1.POST("/forms/submit", s.submitPublicTenantForm)

	// Test form submit with missing fields
	body, _ := json.Marshal(map[string]any{
		"tenant": "",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forms/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for empty tenant, got %d", w.Code)
	}
}

func TestStoreCustomerTokenGeneration(t *testing.T) {
	tm := auth.NewTokenManager("my-super-secret-jwt-key-for-test-32!")
	customerID := "654321654321654321654321"
	tenantID := "123456123456123456123456"
	email := "shopper@gmail.com"

	token, err := tm.GenerateStoreCustomerToken(customerID, tenantID, email)
	if err != nil {
		t.Fatalf("failed to generate store customer token: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := tm.ParseStoreCustomerToken(token)
	if err != nil {
		t.Fatalf("failed to parse store customer token: %v", err)
	}

	if claims.Subject != customerID {
		t.Errorf("expected customer ID %s, got %s", customerID, claims.Subject)
	}
	if claims.TenantID != tenantID {
		t.Errorf("expected tenant ID %s, got %s", tenantID, claims.TenantID)
	}
	if claims.Email != email {
		t.Errorf("expected email %s, got %s", email, claims.Email)
	}
}

func TestPublicCORSMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	v1 := router.Group("/api/v1")
	v1.Use(publicCORSMiddleware())
	v1.OPTIONS("/forms/submit", func(c *gin.Context) { c.Status(http.StatusOK) })
	v1.POST("/forms/submit", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	// Test OPTIONS preflight
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/forms/submit", nil)
	req.Header.Set("Origin", "https://myshop.pages.dev")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for OPTIONS preflight, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "https://myshop.pages.dev" {
		t.Errorf("expected Access-Control-Allow-Origin to match origin, got %s", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestDomainValidationRegex(t *testing.T) {
	valid := []string{"shop.mybrand.com", "www.client.co.uk", "store123.agency.io", "my-store.brand.com"}
	for _, d := range valid {
		if !validDomainRegex.MatchString(d) {
			t.Errorf("expected %s to be valid domain", d)
		}
	}

	invalid := []string{"invalid domain", "http://domain.com", "test@test", "domain..com"}
	for _, d := range invalid {
		if validDomainRegex.MatchString(d) {
			t.Errorf("expected %s to be invalid domain", d)
		}
	}
}

func TestTenantDeletionRetentionTime(t *testing.T) {
	now := time.Now()
	purgeAt := now.Add(30 * 24 * time.Hour)
	tenant := models.Tenant{
		Status:    models.TenantStatusDeleted,
		IsDeleted: true,
		DeletedAt: &now,
		PurgeAt:   &purgeAt,
	}

	if tenant.Status != models.TenantStatusDeleted {
		t.Errorf("expected tenant status %s, got %s", models.TenantStatusDeleted, tenant.Status)
	}
	if !tenant.IsDeleted {
		t.Error("expected tenant to be marked deleted")
	}
	days := int(tenant.PurgeAt.Sub(*tenant.DeletedAt).Hours() / 24)
	if days != 30 {
		t.Errorf("expected 30 days retention, got %d", days)
	}
}

func TestVerifyDomainTLSInvalid(t *testing.T) {
	valid, issuer, msg := verifyDomainTLS("nonexistent-domain-xyz-12345.local")
	if valid {
		t.Errorf("expected nonexistent domain to fail TLS verification, got valid")
	}
	if msg == "" {
		t.Errorf("expected error message for nonexistent domain")
	}
	_ = issuer
}

func TestProxyToAstroForwardsTenantThemeHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var gotSubdomain, gotTheme string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSubdomain = r.Header.Get("X-Tenant-Subdomain")
		gotTheme = r.Header.Get("X-Tenant-Theme")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	s := &Server{}
	router := gin.New()
	router.GET("/editor", func(c *gin.Context) {
		setProxyTenantContext(c, &models.Tenant{
			Subdomain:   "mimin",
			ActiveTheme: "default",
		})
		s.proxyToAstro(c, upstream.URL, "/editor")
	})

	proxySrv := httptest.NewServer(router)
	defer proxySrv.Close()

	resp, err := http.Get(proxySrv.URL + "/editor?tenant=mimin")
	if err != nil {
		t.Fatalf("failed to request proxy server: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if gotSubdomain != "mimin" {
		t.Errorf("expected X-Tenant-Subdomain=mimin, got %q", gotSubdomain)
	}
	if gotTheme != "default" {
		t.Errorf("expected X-Tenant-Theme=default, got %q", gotTheme)
	}
}

func TestExtractEditorTenantSlugFromReferer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/themes", nil)
	c.Request.Header.Set("Referer", "https://bugmega.com/editor?tenant=mimin&slug=home")

	if got := extractEditorTenantSlug(c); got != "mimin" {
		t.Errorf("expected mimin from Referer, got %q", got)
	}
}

func TestBuildAndPublishSeparatesDevAndPublishedAndExcludesEditors(t *testing.T) {
	tmpRoot := t.TempDir()
	s := &Server{
		tenantsRootOverride: tmpRoot,
		disableSystemNginx:  true,
	}

	devData := s.tenantDevDataDir("mimin")
	devUploads := s.tenantDevUploadsDir("mimin")
	if err := os.MkdirAll(devData, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(devUploads, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(devUploads, "logo.png"), []byte("pngdata"), 0644); err != nil {
		t.Fatal(err)
	}
	pagesJSON := `{
		"home": {"title": "Home"},
		"about": {"title": "About"},
		"editor": {"title": "Should Never Publish"},
		"header-builder": {"title": "Should Never Publish"}
	}`
	if err := os.WriteFile(filepath.Join(devData, "pages-default.json"), []byte(pagesJSON), 0644); err != nil {
		t.Fatal(err)
	}

	requestedPaths := []string{}
	mockAstro := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Tenant-Mode") != "published" {
			t.Errorf("expected X-Tenant-Mode=published, got %q", r.Header.Get("X-Tenant-Mode"))
		}
		requestedPaths = append(requestedPaths, r.URL.Path)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<html><body>Published " + r.URL.Path + "</body></html>"))
	}))
	defer mockAstro.Close()

	tenant := &models.Tenant{
		Subdomain:   "mimin",
		CompanyName: "Mimin Shop",
		ActiveTheme: "default",
	}
	res, err := s.buildAndPublishTenantStaticSite(context.Background(), tenant, mockAstro.URL)
	if err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	if res.PagesRendered == 0 {
		t.Fatal("expected at least 1 rendered page")
	}
	for _, p := range requestedPaths {
		if isEditorOrBuilderPath(p) {
			t.Fatalf("editor route %q was requested during publish", p)
		}
	}

	if _, err := os.Stat(filepath.Join(s.tenantPublishedDistDir("mimin"), "index.html")); err != nil {
		t.Fatalf("expected published index.html to exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.tenantPublishedDistDir("mimin"), "uploads", "logo.png")); err != nil {
		t.Fatalf("expected published uploads/logo.png to exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.tenantPublishedDistDir("mimin"), "editor", "index.html")); !os.IsNotExist(err) {
		t.Fatal("editor page should never exist in published/dist")
	}

	// Mutating dev/ after publish must not affect published/data
	if err := os.WriteFile(filepath.Join(devData, "pages-default.json"), []byte(`{"home":{"title":"Edited Draft"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	pubPages, err := os.ReadFile(filepath.Join(s.tenantPublishedDataDir("mimin"), "pages-default.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(pubPages), "Edited Draft") {
		t.Fatal("published/data should stay isolated from dev/data edits")
	}
}

func TestServeTenantWebsiteNeverServesDevOrEditors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tmpRoot := t.TempDir()
	s := &Server{
		tenantsRootOverride: tmpRoot,
		disableSystemNginx:  true,
	}

	// Put secret draft content in dev/ only
	devData := s.tenantDevDataDir("mimin")
	devUploads := s.tenantDevUploadsDir("mimin")
	_ = os.MkdirAll(devData, 0755)
	_ = os.MkdirAll(devUploads, 0755)
	_ = os.WriteFile(filepath.Join(devData, "draft.html"), []byte("DRAFT SECRET"), 0644)
	_ = os.WriteFile(filepath.Join(devUploads, "hero.txt"), []byte("DEV_UPLOAD_OK"), 0644)

	draftTenant := &models.Tenant{
		Subdomain:   "mimin",
		CompanyName: "Mimin Draft",
		ActiveTheme: "default",
		Status:      models.TenantStatusDraft,
	}

	// 1. Custom domain (clientdomain.com) before publish must NEVER serve dev/ content
	customRouter := gin.New()
	customRouter.Any("/*path", func(c *gin.Context) {
		s.serveTenantWebsite(c, draftTenant, true)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	customRouter.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "has not been published yet") {
		t.Fatalf("expected unpublished notice on custom domain, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "DRAFT SECRET") {
		t.Fatal("draft dev/ content leaked on unpublished custom domain")
	}

	// 2. Public subdomain (<sub >.bugmega.com) is accessible without draft lock (serves dev uploads) and blocks editors
	subRouter := gin.New()
	subRouter.Any("/*path", func(c *gin.Context) {
		s.serveTenantWebsite(c, draftTenant, false)
	})
	reqSubUp := httptest.NewRequest(http.MethodGet, "/uploads/hero.txt", nil)
	wSubUp := httptest.NewRecorder()
	subRouter.ServeHTTP(wSubUp, reqSubUp)
	if wSubUp.Code != http.StatusOK || !strings.Contains(wSubUp.Body.String(), "DEV_UPLOAD_OK") {
		t.Fatalf("expected subdomain to serve dev upload publicly, got %d: %s", wSubUp.Code, wSubUp.Body.String())
	}

	// 3. Publish static index.html and verify custom domain serves live HTML & both block editors
	pubDist := s.tenantPublishedDistDir("mimin")
	_ = os.MkdirAll(pubDist, 0755)
	_ = os.WriteFile(filepath.Join(pubDist, "index.html"), []byte("LIVE PUBLISHED"), 0644)
	now := time.Now()
	draftTenant.Status = models.TenantStatusActive
	draftTenant.PublishedAt = &now

	reqLive := httptest.NewRequest(http.MethodGet, "/", nil)
	wLive := httptest.NewRecorder()
	customRouter.ServeHTTP(wLive, reqLive)
	if wLive.Code != http.StatusOK || !strings.Contains(wLive.Body.String(), "LIVE PUBLISHED") {
		t.Fatalf("expected live published HTML, got %d: %s", wLive.Code, wLive.Body.String())
	}

	for _, blocked := range []string{"/editor", "/editor-container-layout.js", "/header-builder", "/robots-editor", "/api/pages", "/api/save-page", "/preview/default"} {
		for _, r := range []*gin.Engine{customRouter, subRouter} {
			reqBlk := httptest.NewRequest(http.MethodGet, blocked, nil)
			wBlk := httptest.NewRecorder()
			r.ServeHTTP(wBlk, reqBlk)
			if wBlk.Code != http.StatusNotFound {
				t.Errorf("expected 404 for blocked path %s, got %d", blocked, wBlk.Code)
			}
		}
	}

	// 4. Main platform middleware must block unauthenticated access to editor pages and editor APIs
	sMain := &Server{}
	mainRouter := gin.New()
	mainRouter.Use(sMain.tenantHostMiddleware())
	mainRouter.GET("/ok", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	for _, edPage := range []string{"/editor?tenant=mimin", "/header-builder?tenant=mimin", "/preview/default?tenant=mimin"} {
		reqEd := httptest.NewRequest(http.MethodGet, edPage, nil)
		reqEd.Host = "bugmega.com"
		wEd := httptest.NewRecorder()
		mainRouter.ServeHTTP(wEd, reqEd)
		if wEd.Code != http.StatusFound || !strings.HasPrefix(wEd.Header().Get("Location"), "/login?redirect=") {
			t.Errorf("expected redirect to /login for unauthenticated %s, got %d loc=%q", edPage, wEd.Code, wEd.Header().Get("Location"))
		}
	}

	for _, edAPI := range []string{"/api/pages?tenant=mimin", "/api/save-page?tenant=mimin", "/editor-container-layout.js"} {
		reqAPI := httptest.NewRequest(http.MethodPost, edAPI, nil)
		reqAPI.Host = "bugmega.com"
		wAPI := httptest.NewRecorder()
		mainRouter.ServeHTTP(wAPI, reqAPI)
		if wAPI.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for unauthenticated editor API/asset %s, got %d", edAPI, wAPI.Code)
		}
	}
}

func TestNginxTenantVhostLifecycleAndDirInspect(t *testing.T) {
	tmpRoot := t.TempDir()
	availDir := filepath.Join(tmpRoot, "sites-available")
	enabDir := filepath.Join(tmpRoot, "sites-enabled")
	tenantsRoot := filepath.Join(tmpRoot, "tenants")

	s := &Server{
		tenantsRootOverride:     tenantsRoot,
		nginxSitesAvailOverride: availDir,
		nginxSitesEnabOverride:  enabDir,
		disableSystemNginx:      true,
	}

	if err := s.ensureNginxTenantVhost("shop.clientdomain.com"); err != nil {
		t.Fatalf("ensureNginxTenantVhost failed: %v", err)
	}
	if _, ready := s.nginxTenantVhostExists("shop.clientdomain.com"); !ready {
		t.Fatal("expected nginx vhost symlink to be ready")
	}

	_ = os.MkdirAll(s.tenantDevDataDir("mimin"), 0755)
	_ = os.WriteFile(filepath.Join(s.tenantDevDataDir("mimin"), "pages-default.json"), []byte("{}"), 0644)
	_ = os.MkdirAll(s.tenantPublishedDistDir("mimin"), 0755)
	_ = os.WriteFile(filepath.Join(s.tenantPublishedDistDir("mimin"), "index.html"), []byte("<h1>Hi</h1>"), 0644)

	details := s.inspectTenantDirectories("mimin", "shop.clientdomain.com")
	if !details.Dev.Exists || details.Dev.DataFilesCount != 1 {
		t.Errorf("unexpected dev stats: %+v", details.Dev)
	}
	if !details.Published.DistExists || !details.Published.IndexHTMLExists || details.Published.EditorFilesFound != 0 {
		t.Errorf("unexpected published stats: %+v", details.Published)
	}
	if !details.NginxVhostReady {
		t.Error("expected NginxVhostReady=true")
	}

	if err := s.removeNginxTenantVhost("shop.clientdomain.com"); err != nil {
		t.Fatalf("removeNginxTenantVhost failed: %v", err)
	}
	if _, ready := s.nginxTenantVhostExists("shop.clientdomain.com"); ready {
		t.Fatal("expected nginx vhost symlink to be removed")
	}
}

func TestCustomDomainPaymentGateAndPricingDefaults(t *testing.T) {
	s := &Server{}
	monthly, yearly, _ := s.customDomainPricing(context.Background())
	if monthly != 1500 || yearly != 20000 {
		t.Fatalf("expected default pricing 1500/20000 cents, got %d/%d", monthly, yearly)
	}
	if MaxWebsitesPerUser != 3 {
		t.Fatalf("expected MaxWebsitesPerUser=3, got %d", MaxWebsitesPerUser)
	}

	unpaid := &models.Tenant{Subdomain: "mimin", CustomDomainPaid: false}
	if s.tenantHasActiveDomainPlan(context.Background(), unpaid) {
		t.Fatal("expected unpaid tenant to fail active domain plan check")
	}

	past := time.Now().Add(-24 * time.Hour)
	expired := &models.Tenant{Subdomain: "mimin", CustomDomainPaid: true, CustomDomainPaidUntil: &past}
	if s.tenantHasActiveDomainPlan(context.Background(), expired) {
		t.Fatal("expected expired tenant domain plan to fail check")
	}

	future := time.Now().Add(30 * 24 * time.Hour)
	paid := &models.Tenant{Subdomain: "mimin", CustomDomainPaid: true, CustomDomainPaidUntil: &future}
	if !s.tenantHasActiveDomainPlan(context.Background(), paid) {
		t.Fatal("expected paid tenant with future expiry to pass active domain plan check")
	}

	now := time.Now()
	if days := int(domainPlanExpiry(now, "monthly").Sub(now).Hours() / 24); days != 30 {
		t.Errorf("expected 30 days for monthly plan, got %d", days)
	}
	if days := int(domainPlanExpiry(now, "yearly").Sub(now).Hours() / 24); days != 365 {
		t.Errorf("expected 365 days for yearly plan, got %d", days)
	}

	limitLine := publicPlanLimitsLine(models.Plan{Name: "Website Package", SeatLimit: 250, ProjectLimit: 1})
	if limitLine != "Per published domain" {
		t.Errorf("expected 'Per published domain', got %q", limitLine)
	}
}

func TestEnsureTenantDevDirectorySeedsCleanDataAndUploads(t *testing.T) {
	tmpRoot := t.TempDir()
	s := &Server{
		tenantsRootOverride: tmpRoot,
		disableSystemNginx:  true,
	}

	s.ensureTenantDevDirectory("freshsite", "default")

	devData := s.tenantDevDataDir("freshsite")
	devUploads := s.tenantDevUploadsDir("freshsite")

	footersBytes, err := os.ReadFile(filepath.Join(devData, "footers.json"))
	if err != nil {
		t.Fatalf("expected seeded footers.json: %v", err)
	}
	if !strings.Contains(string(footersBytes), `"/brand-logo.svg"`) {
		t.Errorf("expected seeded footers.json to reference /brand-logo.svg")
	}

	tplBytes, err := os.ReadFile(filepath.Join(devData, "templates.json"))
	if err != nil {
		t.Fatalf("expected seeded templates.json: %v", err)
	}
	if !strings.Contains(string(tplBytes), "bfn-brand-group") {
		t.Errorf("expected seeded templates.json to include vertical alignment CSS")
	}

	entries, err := os.ReadDir(devUploads)
	if err != nil {
		t.Fatalf("expected seeded uploads dir: %v", err)
	}
	if len(entries) == 0 {
		t.Errorf("expected seeded uploads in dev/uploads, got empty directory")
	}
}
