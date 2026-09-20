package handlers

import (
	"html"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
)

func loginDeviceLabel(userAgent string) string {
	ua := strings.ToLower(strings.TrimSpace(userAgent))
	browser := "Unknown browser"
	switch {
	case strings.Contains(ua, "edg/") || strings.Contains(ua, "edgios/") || strings.Contains(ua, "edga/"):
		browser = "Microsoft Edge"
	case strings.Contains(ua, "opr/") || strings.Contains(ua, "opera"):
		browser = "Opera"
	case strings.Contains(ua, "firefox/") || strings.Contains(ua, "fxios/"):
		browser = "Mozilla Firefox"
	case strings.Contains(ua, "chrome/") || strings.Contains(ua, "crios/"):
		browser = "Google Chrome"
	case strings.Contains(ua, "safari/"):
		browser = "Safari"
	}

	device := "an unknown device"
	switch {
	case strings.Contains(ua, "iphone"):
		device = "an iPhone"
	case strings.Contains(ua, "ipad"):
		device = "an iPad"
	case strings.Contains(ua, "android"):
		device = "an Android device"
	case strings.Contains(ua, "windows"):
		device = "a Windows computer"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os x"):
		device = "a Mac"
	case strings.Contains(ua, "cros"):
		device = "a Chromebook"
	case strings.Contains(ua, "linux"):
		device = "a Linux computer"
	}

	return browser + " on " + device
}

func buildLoginNotificationEmail(appName, appURL string, user models.User, method, ip, userAgent string, loggedInAt time.Time) models.EmailQueueItem {
	appName = firstNonEmpty(strings.TrimSpace(appName), "bugmega")
	name := firstNonEmpty(strings.TrimSpace(user.Name), strings.TrimSpace(user.Username), strings.TrimSpace(user.Email), "there")
	method = firstNonEmpty(strings.TrimSpace(method), "Password")
	ip = firstNonEmpty(strings.TrimSpace(ip), "Unavailable")
	device := loginDeviceLabel(userAgent)
	when := loggedInAt.UTC().Format("Jan 2, 2006 at 3:04 PM UTC")

	body := `<p>Hello ` + html.EscapeString(name) + `,</p>` +
		`<p>Your ` + html.EscapeString(appName) + ` account was signed in on a device.</p>` +
		`<table role="presentation" style="border-collapse:collapse;margin:18px 0;">` +
		`<tr><td style="padding:5px 18px 5px 0;color:#64748b;">Device</td><td style="padding:5px 0;font-weight:700;">` + html.EscapeString(device) + `</td></tr>` +
		`<tr><td style="padding:5px 18px 5px 0;color:#64748b;">Sign-in method</td><td style="padding:5px 0;font-weight:700;">` + html.EscapeString(method) + `</td></tr>` +
		`<tr><td style="padding:5px 18px 5px 0;color:#64748b;">Time</td><td style="padding:5px 0;font-weight:700;">` + html.EscapeString(when) + `</td></tr>` +
		`<tr><td style="padding:5px 18px 5px 0;color:#64748b;">IP address</td><td style="padding:5px 0;font-weight:700;">` + html.EscapeString(ip) + `</td></tr>` +
		`</table>` +
		`<p>If this was you, no action is needed. If you do not recognize this login, change your password immediately and enable two-factor authentication.</p>`
	if strings.TrimSpace(appURL) != "" {
		body += `<p style="margin:20px 0;"><a href="` + html.EscapeString(strings.TrimRight(strings.TrimSpace(appURL), "/")) + `" style="display:inline-block;padding:10px 18px;background:#39c2a9;color:#fff;text-decoration:none;border-radius:8px;font-weight:800;">Open ` + html.EscapeString(appName) + `</a></p>`
	}

	return models.EmailQueueItem{
		Recipient: strings.ToLower(strings.TrimSpace(user.Email)),
		Type:      "login_notification",
		Subject:   "New login to your " + appName + " account",
		BodyHTML:  body,
	}
}

func (s *Server) enqueueLoginNotificationEmail(c *gin.Context, user models.User, method string) {
	if c == nil || c.Request == nil || s.mailer == nil {
		return
	}
	recipient := strings.ToLower(strings.TrimSpace(user.Email))
	if recipient == "" || !strings.Contains(recipient, "@") || !s.mailer.CanSend(c.Request.Context()) {
		return
	}
	item := buildLoginNotificationEmail(
		s.cfg.AppName,
		s.cfg.AppURL,
		user,
		method,
		realClientIP(c),
		c.Request.UserAgent(),
		time.Now(),
	)
	_ = s.mailer.Enqueue(c.Request.Context(), item)
}
