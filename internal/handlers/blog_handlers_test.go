package handlers

import (
	"strings"
	"testing"
)

func TestPositiveBlogPage(t *testing.T) {
	tests := map[string]int64{"": 1, "0": 1, "-4": 1, "2": 2, "999999": 10000, "not-a-number": 1}
	for input, expected := range tests {
		if got := positiveBlogPage(input); got != expected {
			t.Errorf("positiveBlogPage(%q) = %d, want %d", input, got, expected)
		}
	}
}

func TestBlogExcerptStripsMarkupAndLimitsLength(t *testing.T) {
	if got := blogExcerpt(`<p>Hello <strong>world</strong> &amp; friends.</p>`); got != "Hello world & friends." {
		t.Fatalf("unexpected excerpt: %q", got)
	}
	long := strings.Repeat("a", 220)
	got := blogExcerpt(long)
	if len([]rune(got)) != 180 || !strings.HasSuffix(got, "...") {
		t.Fatalf("long excerpt was not limited correctly: %q", got)
	}
}

func TestSafeBlogMediaURL(t *testing.T) {
	for _, value := range []string{"javascript:alert(1)", "data:image/svg+xml,test", "relative/file.png"} {
		if got := safeBlogMediaURL(value); got != "" {
			t.Errorf("unsafe media URL %q was accepted as %q", value, got)
		}
	}
	for _, value := range []string{"/uploads/users/owner/image.webp", "https://cdn.example.test/image.jpg"} {
		if got := safeBlogMediaURL(value); got != value {
			t.Errorf("safe media URL %q was rejected", value)
		}
	}
}
