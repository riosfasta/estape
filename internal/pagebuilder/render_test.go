package pagebuilder

import (
	"strings"
	"testing"

	"bugmark/internal/models"
)

func TestColumnBackgroundImageAndYouTubeVideo(t *testing.T) {
	blocks := []models.PageBlock{{
		Type: "column",
		Props: map[string]interface{}{
			"background_image_url":       "/uploads/users/owner/hero.webp",
			"background_image_repeat":    "no-repeat",
			"background_image_size":      "cover",
			"background_image_position":  "top right",
			"background_video_url":       "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"background_video_position":  "bottom center",
			"background_video_scale":     150,
			"background_overlay_color":   "#112233",
			"background_overlay_opacity": 35,
		},
		Children: []models.PageBlock{{Type: "text", Props: map[string]interface{}{"text": "Foreground content"}}},
	}}

	rendered := Render(blocks, RenderContext{})
	for _, expected := range []string{
		`background-image:url(&quot;/uploads/users/owner/hero.webp&quot;)`,
		`background-repeat:no-repeat`,
		`background-size:cover`,
		`background-position:top right`,
		`builder-column-video-bottom-center`,
		`--builder-video-scale:1.5`,
		`https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;mute=1`,
		`background-color:#112233;opacity:0.35`,
		`Foreground content`,
	} {
		if !strings.Contains(rendered, expected) {
			t.Errorf("rendered column is missing %q: %s", expected, rendered)
		}
	}
}

func TestColumnBackgroundRejectsUnsafeMediaURLs(t *testing.T) {
	blocks := []models.PageBlock{{
		Type: "column",
		Props: map[string]interface{}{
			"background_image_url": "javascript:alert(1)",
			"background_video_url": "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
		},
	}}

	rendered := Render(blocks, RenderContext{})
	if strings.Contains(rendered, "background-image") || strings.Contains(rendered, "<iframe") || strings.Contains(rendered, "evil.test") {
		t.Fatalf("unsafe column background media was rendered: %s", rendered)
	}
}

func TestBlogGridShortcode(t *testing.T) {
	blocks := []models.PageBlock{{Type: "rich_text", Props: map[string]interface{}{"text": "<p>Latest</p>[[blog_grid]]"}}}
	rendered := Render(blocks, RenderContext{BlogGridHTML: `<div class="blog-grid">articles</div>`})
	if !strings.Contains(rendered, `<div class="blog-grid">articles</div>`) || strings.Contains(rendered, "[[blog_grid]]") {
		t.Fatalf("blog shortcode was not expanded: %s", rendered)
	}
}
