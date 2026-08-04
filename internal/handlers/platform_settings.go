package handlers

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

var hexColorPattern = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

type siteSettingsUpdateRequest struct {
	SiteName                 string              `json:"site_name"`
	CompanySlogan            string              `json:"company_slogan"`
	CompanyEmail             string              `json:"company_email"`
	CompanyContact           string              `json:"company_contact"`
	OwnerName                string              `json:"owner_name"`
	CompanyAddress           string              `json:"company_address"`
	LogoURL                  string              `json:"logo_url"`
	FaviconURL               string              `json:"favicon_url"`
	SupportPhone             string              `json:"support_phone"`
	GoogleSigninEnabled      bool                `json:"google_signin_enabled"`
	GoogleClientID           string              `json:"google_client_id"`
	GoogleClientSecret       string              `json:"google_client_secret"`
	GoogleRedirectURL        string              `json:"google_redirect_url"`
	ClearGoogleClientSecret  bool                `json:"clear_google_client_secret"`
	SMTPEnabled              bool                `json:"smtp_enabled"`
	SMTPHost                 string              `json:"smtp_host"`
	SMTPPort                 string              `json:"smtp_port"`
	SMTPUser                 string              `json:"smtp_user"`
	SMTPPassword             string              `json:"smtp_password"`
	SMTPFrom                 string              `json:"smtp_from"`
	ClearSMTPPassword        bool                `json:"clear_smtp_password"`
	StripeEnabled            bool                `json:"stripe_enabled"`
	StripePublishableKey     string              `json:"stripe_publishable_key"`
	StripeSecretKey          string              `json:"stripe_secret_key"`
	StripeWebhookSecret      string              `json:"stripe_webhook_secret"`
	ClearStripeSecretKey     bool                `json:"clear_stripe_secret_key"`
	ClearStripeWebhookSecret bool                `json:"clear_stripe_webhook_secret"`
	PayPalEnabled            bool                `json:"paypal_enabled"`
	PayPalMode               string              `json:"paypal_mode"`
	PayPalClientID           string              `json:"paypal_client_id"`
	PayPalClientSecret       string              `json:"paypal_client_secret"`
	PayPalWebhookID          string              `json:"paypal_webhook_id"`
	ClearPayPalClientSecret  bool                `json:"clear_paypal_client_secret"`
	ThemePrimaryColor        string              `json:"theme_primary_color"`
	ThemePrimaryStrongColor  string              `json:"theme_primary_strong_color"`
	ThemeButtonColor         string              `json:"theme_button_color"`
	ThemeButtonTextColor     string              `json:"theme_button_text_color"`
	ThemeFontColor           string              `json:"theme_font_color"`
	ThemeHeadingColor        string              `json:"theme_heading_color"`
	ThemeBackgroundColor     string              `json:"theme_background_color"`
	SocialLinks              []models.SocialLink `json:"social_links"`
}

func (s *Server) loadSiteSettings(ctx context.Context) (models.SiteSettings, error) {
	var settings models.SiteSettings
	err := s.store.C("site_settings").FindOne(ctx, bson.M{}).Decode(&settings)
	if err != nil {
		return s.defaultSiteSettings(time.Now()), err
	}
	return settings, nil
}

func (s *Server) defaultSiteSettings(now time.Time) models.SiteSettings {
	return models.SiteSettings{
		SiteName:             s.cfg.AppName,
		CompanySlogan:        "Task management with visual website feedback",
		CompanyEmail:         "support@bugmega.local",
		CompanyContact:       "support@bugmega.local",
		OwnerName:            s.cfg.OwnerName,
		CompanyAddress:       "Set your company address in Admin Settings",
		GoogleSigninEnabled:  s.cfg.GoogleClientID != "" && s.cfg.GoogleClientSecret != "",
		GoogleClientID:       s.cfg.GoogleClientID,
		GoogleClientSecret:   s.cfg.GoogleClientSecret,
		GoogleRedirectURL:    s.cfg.GoogleRedirectURL,
		SMTPEnabled:          s.cfg.SMTPHost != "" && s.cfg.SMTPUser != "",
		SMTPHost:             s.cfg.SMTPHost,
		SMTPPort:             s.cfg.SMTPPort,
		SMTPUser:             s.cfg.SMTPUser,
		SMTPPassword:         s.cfg.SMTPPassword,
		SMTPFrom:             s.cfg.SMTPFrom,
		StripeEnabled:        s.cfg.StripeSecretKey != "",
		StripePublishableKey: s.cfg.StripePublishableKey,
		StripeSecretKey:      s.cfg.StripeSecretKey,
		StripeWebhookSecret:  s.cfg.StripeWebhookSecret,
		PayPalEnabled:        s.cfg.PayPalClientID != "" && s.cfg.PayPalClientSecret != "",
		PayPalMode:           firstNonEmpty(s.cfg.PayPalMode, "sandbox"),
		PayPalClientID:       s.cfg.PayPalClientID,
		PayPalClientSecret:   s.cfg.PayPalClientSecret,
		PayPalWebhookID:      s.cfg.PayPalWebhookID,
		PublicNavCompanyName: s.cfg.AppName,
		PublicNavButtonText:  "Get Started",
		PublicNavButtonURL:   "/register",
		PublicNavButtonStyle: "primary",
		PublicNavItems:       defaultPublicNavItems(),
		UpdatedAt:            now,
	}
}

func defaultPublicNavItems() []models.PublicNavItem {
	return []models.PublicNavItem{
		{ID: "home", Label: "Home", URL: "/", Visible: true, Order: 1},
		{ID: "pricing", Label: "Pricing", URL: "/pricing", Visible: true, Order: 2},
		{ID: "login", Label: "Login", URL: "/login", Visible: true, Order: 3},
	}
}

func (s *Server) settingsWithConfigFallback(settings models.SiteSettings) models.SiteSettings {
	googleTouched := settings.GoogleSigninEnabled ||
		strings.TrimSpace(settings.GoogleClientID) != "" ||
		strings.TrimSpace(settings.GoogleClientSecret) != "" ||
		strings.TrimSpace(settings.GoogleRedirectURL) != ""
	smtpTouched := settings.SMTPEnabled ||
		strings.TrimSpace(settings.SMTPHost) != "" ||
		strings.TrimSpace(settings.SMTPUser) != "" ||
		strings.TrimSpace(settings.SMTPPassword) != "" ||
		strings.TrimSpace(settings.SMTPFrom) != ""
	stripeTouched := settings.StripeEnabled ||
		strings.TrimSpace(settings.StripePublishableKey) != "" ||
		strings.TrimSpace(settings.StripeSecretKey) != "" ||
		strings.TrimSpace(settings.StripeWebhookSecret) != ""
	payPalTouched := settings.PayPalEnabled ||
		strings.TrimSpace(settings.PayPalClientID) != "" ||
		strings.TrimSpace(settings.PayPalClientSecret) != "" ||
		strings.TrimSpace(settings.PayPalWebhookID) != ""

	if strings.TrimSpace(settings.SiteName) == "" {
		settings.SiteName = s.cfg.AppName
	}
	if strings.TrimSpace(settings.OwnerName) == "" {
		settings.OwnerName = s.cfg.OwnerName
	}
	if strings.TrimSpace(settings.GoogleClientID) == "" {
		settings.GoogleClientID = s.cfg.GoogleClientID
	}
	if strings.TrimSpace(settings.GoogleClientSecret) == "" {
		settings.GoogleClientSecret = s.cfg.GoogleClientSecret
	}
	if strings.TrimSpace(settings.GoogleRedirectURL) == "" {
		settings.GoogleRedirectURL = s.cfg.GoogleRedirectURL
	}
	if strings.TrimSpace(settings.SMTPHost) == "" {
		settings.SMTPHost = s.cfg.SMTPHost
	}
	if strings.TrimSpace(settings.SMTPPort) == "" {
		settings.SMTPPort = firstNonEmpty(s.cfg.SMTPPort, "587")
	}
	if strings.TrimSpace(settings.SMTPUser) == "" {
		settings.SMTPUser = s.cfg.SMTPUser
	}
	if strings.TrimSpace(settings.SMTPPassword) == "" {
		settings.SMTPPassword = s.cfg.SMTPPassword
	}
	if strings.TrimSpace(settings.SMTPFrom) == "" {
		settings.SMTPFrom = s.cfg.SMTPFrom
	}
	if strings.TrimSpace(settings.StripePublishableKey) == "" {
		settings.StripePublishableKey = s.cfg.StripePublishableKey
	}
	if strings.TrimSpace(settings.StripeSecretKey) == "" {
		settings.StripeSecretKey = s.cfg.StripeSecretKey
	}
	if strings.TrimSpace(settings.StripeWebhookSecret) == "" {
		settings.StripeWebhookSecret = s.cfg.StripeWebhookSecret
	}
	if strings.TrimSpace(settings.PayPalMode) == "" {
		settings.PayPalMode = firstNonEmpty(s.cfg.PayPalMode, "sandbox")
	}
	if strings.TrimSpace(settings.PayPalClientID) == "" {
		settings.PayPalClientID = s.cfg.PayPalClientID
	}
	if strings.TrimSpace(settings.PayPalClientSecret) == "" {
		settings.PayPalClientSecret = s.cfg.PayPalClientSecret
	}
	if strings.TrimSpace(settings.PayPalWebhookID) == "" {
		settings.PayPalWebhookID = s.cfg.PayPalWebhookID
	}
	if !googleTouched {
		settings.GoogleSigninEnabled = s.cfg.GoogleClientID != "" && s.cfg.GoogleClientSecret != ""
	}
	if !smtpTouched {
		settings.SMTPEnabled = s.cfg.SMTPHost != "" && s.cfg.SMTPUser != ""
	}
	if !stripeTouched {
		settings.StripeEnabled = s.cfg.StripeSecretKey != ""
	}
	if !payPalTouched {
		settings.PayPalEnabled = s.cfg.PayPalClientID != "" && s.cfg.PayPalClientSecret != ""
	}
	if len(settings.PublicNavItems) == 0 {
		settings.PublicNavItems = defaultPublicNavItems()
	}
	if strings.TrimSpace(settings.PublicNavCompanyName) == "" {
		settings.PublicNavCompanyName = firstNonEmpty(settings.SiteName, s.cfg.AppName)
	}
	if strings.TrimSpace(settings.PublicNavLogoURL) == "" {
		settings.PublicNavLogoURL = settings.LogoURL
	}
	if strings.TrimSpace(settings.PublicNavButtonText) == "" {
		settings.PublicNavButtonText = "Get Started"
	}
	settings.PublicNavButtonURL = normalizePublicNavURL(settings.PublicNavButtonURL, "/register")
	settings.PublicNavButtonStyle = normalizePublicNavButtonStyle(settings.PublicNavButtonStyle)
	return settings
}

func (s *Server) sanitizedSiteSettings(settings models.SiteSettings) gin.H {
	settings = s.settingsWithConfigFallback(settings)
	payload := gin.H{
		"id":                        settings.ID,
		"site_name":                 settings.SiteName,
		"company_slogan":            settings.CompanySlogan,
		"company_email":             settings.CompanyEmail,
		"company_contact":           settings.CompanyContact,
		"owner_name":                settings.OwnerName,
		"company_address":           settings.CompanyAddress,
		"logo_url":                  settings.LogoURL,
		"favicon_url":               settings.FaviconURL,
		"support_phone":             settings.SupportPhone,
		"google_signin_enabled":     settings.GoogleSigninEnabled,
		"google_client_id":          settings.GoogleClientID,
		"google_redirect_url":       settings.GoogleRedirectURL,
		"google_client_secret_set":  secretSet(settings.GoogleClientSecret),
		"smtp_enabled":              settings.SMTPEnabled,
		"smtp_host":                 settings.SMTPHost,
		"smtp_port":                 settings.SMTPPort,
		"smtp_user":                 settings.SMTPUser,
		"smtp_from":                 settings.SMTPFrom,
		"smtp_password_set":         secretSet(settings.SMTPPassword),
		"stripe_enabled":            settings.StripeEnabled,
		"stripe_publishable_key":    settings.StripePublishableKey,
		"stripe_secret_key_set":     secretSet(settings.StripeSecretKey),
		"stripe_webhook_secret_set": secretSet(settings.StripeWebhookSecret),
		"paypal_enabled":            settings.PayPalEnabled,
		"paypal_mode":               firstNonEmpty(settings.PayPalMode, "sandbox"),
		"paypal_client_id":          settings.PayPalClientID,
		"paypal_client_secret_set":  secretSet(settings.PayPalClientSecret),
		"paypal_webhook_id":         settings.PayPalWebhookID,
		"public_nav_logo_url":       settings.PublicNavLogoURL,
		"public_nav_company_name":   settings.PublicNavCompanyName,
		"public_nav_button_text":    settings.PublicNavButtonText,
		"public_nav_button_url":     settings.PublicNavButtonURL,
		"public_nav_button_style":   settings.PublicNavButtonStyle,
		"public_nav":                s.publicNavSettingsPayload(settings),
		"public_nav_items":          settings.PublicNavItems,
		"social_links":              normalizeSocialLinks(settings.SocialLinks),
		"updated_at":                settings.UpdatedAt,
	}
	for key, value := range publicThemeSettings(settings) {
		payload[key] = value
	}
	return payload
}

func (s *Server) publicPlatformSettings(ctx context.Context) gin.H {
	settings, _ := s.loadSiteSettings(ctx)
	settings = s.settingsWithConfigFallback(settings)
	payload := gin.H{
		"site_name":        settings.SiteName,
		"company_slogan":   settings.CompanySlogan,
		"company_email":    settings.CompanyEmail,
		"company_contact":  settings.CompanyContact,
		"owner_name":       settings.OwnerName,
		"logo_url":         settings.LogoURL,
		"favicon_url":      settings.FaviconURL,
		"support_phone":    settings.SupportPhone,
		"public_nav":       s.publicNavSettingsPayload(settings),
		"public_nav_items": settings.PublicNavItems,
		"social_links":     normalizeSocialLinks(settings.SocialLinks),
		"google_signin_enabled": googleOAuthRuntimeConfig{
			Enabled:      settings.GoogleSigninEnabled,
			ClientID:     strings.TrimSpace(settings.GoogleClientID),
			ClientSecret: strings.TrimSpace(settings.GoogleClientSecret),
			RedirectURL:  strings.TrimSpace(settings.GoogleRedirectURL),
		}.Configured(),
	}
	for key, value := range publicThemeSettings(settings) {
		payload[key] = value
	}
	return payload
}

func (s *Server) getPublicPlatformSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"settings": s.publicPlatformSettings(c.Request.Context())})
}

func (s *Server) publicNavSettingsPayload(settings models.SiteSettings) gin.H {
	settings = s.settingsWithConfigFallback(settings)
	companyName := firstNonEmpty(settings.PublicNavCompanyName, settings.SiteName, s.cfg.AppName, "bugmega")
	style := normalizePublicNavButtonStyle(settings.PublicNavButtonStyle)
	return gin.H{
		"logo_url":      settings.PublicNavLogoURL,
		"company_name":  companyName,
		"brand_initial": publicNavBrandInitial(companyName),
		"button_text":   settings.PublicNavButtonText,
		"button_url":    normalizePublicNavURL(settings.PublicNavButtonURL, "/register"),
		"button_style":  style,
		"button_class":  publicNavButtonClass(style),
	}
}

func (s *Server) publicPageChrome(settings models.SiteSettings) gin.H {
	settings = s.settingsWithConfigFallback(settings)
	nav := s.publicNavSettingsPayload(settings)
	return gin.H{
		"AppName":         firstNonEmpty(settings.SiteName, s.cfg.AppName),
		"FaviconURL":      settings.FaviconURL,
		"NavItems":        publicVisibleNavItems(settings.PublicNavItems),
		"NavLogoURL":      nav["logo_url"],
		"NavBrandName":    nav["company_name"],
		"NavBrandInitial": nav["brand_initial"],
		"NavButtonText":   nav["button_text"],
		"NavButtonURL":    nav["button_url"],
		"NavButtonClass":  nav["button_class"],
	}
}

func (s *Server) withPublicPageChrome(settings models.SiteSettings, payload gin.H) gin.H {
	for key, value := range s.publicPageChrome(settings) {
		payload[key] = value
	}
	return payload
}

func normalizePublicNavButtonStyle(style string) string {
	switch strings.ToLower(strings.TrimSpace(style)) {
	case "default", "outline", "secondary":
		return "default"
	case "quiet", "plain":
		return "quiet"
	default:
		return "primary"
	}
}

func publicNavButtonClass(style string) string {
	switch normalizePublicNavButtonStyle(style) {
	case "quiet":
		return "quiet"
	case "default":
		return ""
	default:
		return "primary"
	}
}

func publicNavBrandInitial(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "P"
	}
	runes := []rune(name)
	return strings.ToUpper(string(runes[0]))
}

func publicThemeSettings(settings models.SiteSettings) gin.H {
	return gin.H{
		"theme_primary_color":        settings.ThemePrimaryColor,
		"theme_primary_strong_color": settings.ThemePrimaryStrongColor,
		"theme_button_color":         settings.ThemeButtonColor,
		"theme_button_text_color":    settings.ThemeButtonTextColor,
		"theme_font_color":           settings.ThemeFontColor,
		"theme_heading_color":        settings.ThemeHeadingColor,
		"theme_background_color":     settings.ThemeBackgroundColor,
	}
}

func secretSet(value string) bool {
	return strings.TrimSpace(value) != ""
}

func cleanOptionalHexColor(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true
	}
	if !hexColorPattern.MatchString(value) {
		return "", false
	}
	return strings.ToLower(value), true
}

func normalizeSocialLinks(items []models.SocialLink) []models.SocialLink {
	out := []models.SocialLink{}
	allowedIcons := map[string]bool{
		"link": true, "mail": true, "contact": true, "phone": true, "whatsapp": true,
		"facebook": true, "instagram": true, "tiktok": true, "youtube": true,
	}
	for _, item := range items {
		if len(out) >= 24 {
			break
		}
		label := strings.TrimSpace(item.Label)
		url := strings.TrimSpace(item.URL)
		if label == "" || url == "" || strings.HasPrefix(strings.ToLower(url), "javascript:") {
			continue
		}
		lowerURL := strings.ToLower(url)
		if !(strings.HasPrefix(lowerURL, "http://") ||
			strings.HasPrefix(lowerURL, "https://") ||
			strings.HasPrefix(lowerURL, "mailto:") ||
			strings.HasPrefix(lowerURL, "tel:") ||
			strings.HasPrefix(url, "/") ||
			strings.HasPrefix(url, "#")) {
			url = "https://" + strings.TrimLeft(url, "/")
		}
		icon := strings.ToLower(strings.TrimSpace(item.Icon))
		if !allowedIcons[icon] {
			icon = "link"
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = "social-" + icon + "-" + strings.ToLower(strings.ReplaceAll(label, " ", "-"))
		}
		out = append(out, models.SocialLink{
			ID:      id,
			Label:   label,
			Icon:    icon,
			URL:     url,
			Visible: item.Visible,
			Order:   len(out) + 1,
		})
	}
	return out
}

func (s *Server) paymentProviderEnabled(ctx context.Context, provider string) bool {
	settings, err := s.loadSiteSettings(ctx)
	if err != nil {
		return true
	}
	settings = s.settingsWithConfigFallback(settings)
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "stripe":
		hasSaved := settings.StripeEnabled ||
			strings.TrimSpace(settings.StripePublishableKey) != "" ||
			strings.TrimSpace(settings.StripeSecretKey) != "" ||
			strings.TrimSpace(settings.StripeWebhookSecret) != ""
		if !hasSaved {
			return true
		}
		return settings.StripeEnabled
	case "paypal":
		hasSaved := settings.PayPalEnabled ||
			strings.TrimSpace(settings.PayPalClientID) != "" ||
			strings.TrimSpace(settings.PayPalClientSecret) != "" ||
			strings.TrimSpace(settings.PayPalWebhookID) != ""
		if !hasSaved {
			return true
		}
		return settings.PayPalEnabled
	default:
		return false
	}
}
