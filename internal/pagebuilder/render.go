package pagebuilder

import (
	"bytes"
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"
)

type RenderContext struct {
	Settings models.SiteSettings
	TeamHTML string
}

func Render(blocks []models.PageBlock, ctx RenderContext) string {
	var buf bytes.Buffer
	buf.WriteString(`<section class="legal-section">`)
	for _, block := range blocks {
		renderBlock(&buf, block, ctx)
	}
	buf.WriteString(`</section>`)
	return buf.String()
}

func renderBlock(buf *bytes.Buffer, block models.PageBlock, ctx RenderContext) {
	switch block.Type {
	case "section":
		buf.WriteString(`<div class="builder-section">`)
		for _, child := range block.Children {
			renderBlock(buf, child, ctx)
		}
		buf.WriteString(`</div>`)
	case "column":
		buf.WriteString(`<div class="builder-column">`)
		for _, child := range block.Children {
			renderBlock(buf, child, ctx)
		}
		buf.WriteString(`</div>`)
	case "heading":
		level := safeHeading(propString(block.Props, "level", "h2"))
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", "Heading"), ctx))
		fmt.Fprintf(buf, `<%s>%s</%s>`, level, text, level)
	case "rich_text":
		text := applyShortcodes(propString(block.Props, "text", ""), ctx)
		buf.WriteString(`<div class="rich-text">`)
		buf.WriteString(sanitizeRichText(text))
		buf.WriteString(`</div>`)
	case "image":
		url := safeURL(propString(block.Props, "url", ""))
		alt := html.EscapeString(propString(block.Props, "alt", ""))
		if url != "" {
			fmt.Fprintf(buf, `<figure><img src="%s" alt="%s"></figure>`, url, alt)
		}
	case "button":
		label := html.EscapeString(propString(block.Props, "label", "Learn more"))
		url := safeURL(propString(block.Props, "url", "#"))
		fmt.Fprintf(buf, `<p><a class="btn primary" href="%s">%s</a></p>`, url, label)
	case "divider":
		buf.WriteString(`<hr>`)
	case "spacer":
		height := clampInt(propFloat(block.Props, "height", 24), 8, 96)
		fmt.Fprintf(buf, `<div style="height:%dpx"></div>`, height)
	case "video":
		url := safeVideoURL(propString(block.Props, "url", ""))
		if url != "" {
			fmt.Fprintf(buf, `<iframe class="video-embed" src="%s" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen></iframe>`, url)
		}
	case "team_profiles":
		buf.WriteString(ctx.TeamHTML)
	default:
		if len(block.Children) > 0 {
			for _, child := range block.Children {
				renderBlock(buf, child, ctx)
			}
		}
	}
}

func applyShortcodes(value string, ctx RenderContext) string {
	replacements := map[string]string{
		"[[site_name]]":     ctx.Settings.SiteName,
		"[[company_email]]": ctx.Settings.CompanyEmail,
		"[[owner_name]]":    ctx.Settings.OwnerName,
		"[[current_date]]":  time.Now().Format("January 2, 2006"),
	}
	for token, replacement := range replacements {
		value = strings.ReplaceAll(value, token, replacement)
	}
	return value
}

func propString(props map[string]interface{}, key string, fallback string) string {
	if props == nil {
		return fallback
	}
	value, ok := props[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return fallback
		}
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func propFloat(props map[string]interface{}, key string, fallback float64) float64 {
	if props == nil {
		return fallback
	}
	switch value := props[key].(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case string:
		parsed, err := strconv.ParseFloat(value, 64)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func safeHeading(level string) string {
	switch strings.ToLower(level) {
	case "h1", "h2", "h3", "h4":
		return strings.ToLower(level)
	default:
		return "h2"
	}
}

func safeURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(strings.ToLower(value), "javascript:") {
		return ""
	}
	return html.EscapeString(value)
}

func safeVideoURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "youtube.com/watch?v=") {
		parts := strings.Split(value, "v=")
		id := strings.Split(parts[len(parts)-1], "&")[0]
		return "https://www.youtube.com/embed/" + html.EscapeString(id)
	}
	if strings.Contains(value, "youtu.be/") {
		id := strings.TrimPrefix(value[strings.LastIndex(value, "/")+1:], "/")
		return "https://www.youtube.com/embed/" + html.EscapeString(id)
	}
	if strings.Contains(value, "vimeo.com/") {
		id := value[strings.LastIndex(value, "/")+1:]
		return "https://player.vimeo.com/video/" + html.EscapeString(id)
	}
	return ""
}

var allowedTags = regexp.MustCompile(`&lt;(/?(?:strong|b|em|i|u|p|br|ul|ol|li|a)(?:\s+href=&#34;[^&#34;]*&#34;)?/?)&gt;`)

func sanitizeRichText(value string) string {
	escaped := html.EscapeString(value)
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	return allowedTags.ReplaceAllString(escaped, "<$1>")
}

func clampInt(value float64, min int, max int) int {
	asInt := int(value)
	if asInt < min {
		return min
	}
	if asInt > max {
		return max
	}
	return asInt
}
