package handlers

import (
	"strings"
	"testing"
	"time"

	"bugmark/internal/models"
)

func TestLoginDeviceLabel(t *testing.T) {
	tests := []struct {
		name      string
		userAgent string
		want      string
	}{
		{
			name:      "edge on windows",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
			want:      "Microsoft Edge on a Windows computer",
		},
		{
			name:      "safari on iphone",
			userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
			want:      "Safari on an iPhone",
		},
		{
			name:      "firefox on linux",
			userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
			want:      "Mozilla Firefox on a Linux computer",
		},
		{
			name: "unknown",
			want: "Unknown browser on an unknown device",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := loginDeviceLabel(tt.userAgent); got != tt.want {
				t.Fatalf("loginDeviceLabel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildLoginNotificationEmail(t *testing.T) {
	loggedInAt := time.Date(2026, time.September, 20, 15, 15, 0, 0, time.UTC)
	item := buildLoginNotificationEmail(
		"BugMega",
		"https://bugmega.example/",
		models.User{Name: `<Admin>`, Email: "ADMIN@example.com"},
		"Password",
		"203.0.113.10",
		"Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36",
		loggedInAt,
	)

	if item.Recipient != "admin@example.com" {
		t.Fatalf("Recipient = %q", item.Recipient)
	}
	if item.Type != "login_notification" {
		t.Fatalf("Type = %q", item.Type)
	}
	for _, want := range []string{"Google Chrome on a Windows computer", "203.0.113.10", "Sep 20, 2026 at 3:15 PM UTC", "Password"} {
		if !strings.Contains(item.BodyHTML, want) {
			t.Fatalf("BodyHTML does not contain %q", want)
		}
	}
	if strings.Contains(item.BodyHTML, `<Admin>`) || !strings.Contains(item.BodyHTML, `&lt;Admin&gt;`) {
		t.Fatal("user name was not HTML escaped")
	}
}
