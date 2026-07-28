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
	Settings  models.SiteSettings
	TeamHTML  string
	Plans     []models.Plan
	PageWidth string
}

func Render(blocks []models.PageBlock, ctx RenderContext) string {
	var buf bytes.Buffer
	buf.WriteString(`<section class="legal-section builder-public-page">`)
	for _, block := range blocks {
		renderBlock(&buf, block, ctx)
	}
	buf.WriteString(`</section>`)
	return buf.String()
}

func renderBlock(buf *bytes.Buffer, block models.PageBlock, ctx RenderContext) {
	style := styleAttr(block.Props)
	switch block.Type {
	case "hero":
		eyebrow := html.EscapeString(applyShortcodes(propString(block.Props, "eyebrow", ""), ctx))
		heading := html.EscapeString(applyShortcodes(propString(block.Props, "heading", "Build something useful"), ctx))
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", ""), ctx))
		primaryLabel := html.EscapeString(propString(block.Props, "primary_label", "Get started"))
		primaryURL := safeURL(propString(block.Props, "primary_url", "/register"))
		secondaryLabel := html.EscapeString(propString(block.Props, "secondary_label", "Learn more"))
		secondaryURL := safeURL(propString(block.Props, "secondary_url", ""))
		fmt.Fprintf(buf, `<div class="builder-hero-block"%s>`, style)
		if eyebrow != "" {
			fmt.Fprintf(buf, `<p class="eyebrow">%s</p>`, eyebrow)
		}
		fmt.Fprintf(buf, `<h1>%s</h1>`, heading)
		if text != "" {
			fmt.Fprintf(buf, `<p>%s</p>`, text)
		}
		buf.WriteString(`<div class="hero-actions">`)
		if primaryURL != "" {
			fmt.Fprintf(buf, `<a class="btn primary large" href="%s">%s</a>`, primaryURL, primaryLabel)
		}
		if secondaryURL != "" {
			fmt.Fprintf(buf, `<a class="btn quiet large" href="%s">%s</a>`, secondaryURL, secondaryLabel)
		}
		buf.WriteString(`</div></div>`)
	case "section_heading":
		eyebrow := html.EscapeString(applyShortcodes(propString(block.Props, "eyebrow", ""), ctx))
		heading := html.EscapeString(applyShortcodes(propString(block.Props, "heading", "Section heading"), ctx))
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", ""), ctx))
		fmt.Fprintf(buf, `<div class="section-head builder-section-head"%s>`, style)
		if eyebrow != "" {
			fmt.Fprintf(buf, `<p class="eyebrow">%s</p>`, eyebrow)
		}
		fmt.Fprintf(buf, `<h2>%s</h2>`, heading)
		if text != "" {
			fmt.Fprintf(buf, `<p>%s</p>`, text)
		}
		buf.WriteString(`</div>`)
	case "feature_grid":
		fmt.Fprintf(buf, `<div class="feature-grid builder-feature-grid"%s>`, style)
		for i := 1; i <= 3; i++ {
			title := html.EscapeString(applyShortcodes(propString(block.Props, fmt.Sprintf("title_%d", i), fmt.Sprintf("Feature %d", i)), ctx))
			text := html.EscapeString(applyShortcodes(propString(block.Props, fmt.Sprintf("text_%d", i), "Add details for this feature."), ctx))
			fmt.Fprintf(buf, `<article class="feature-card"><h3>%s</h3><p>%s</p></article>`, title, text)
		}
		buf.WriteString(`</div>`)
	case "cta":
		heading := html.EscapeString(applyShortcodes(propString(block.Props, "heading", "Ready to start?"), ctx))
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", ""), ctx))
		label := html.EscapeString(propString(block.Props, "label", "Get started"))
		url := safeURL(propString(block.Props, "url", "/register"))
		fmt.Fprintf(buf, `<div class="closing-cta builder-cta-block"%s>`, style)
		fmt.Fprintf(buf, `<h2>%s</h2>`, heading)
		if text != "" {
			fmt.Fprintf(buf, `<p>%s</p>`, text)
		}
		if url != "" {
			fmt.Fprintf(buf, `<a class="btn primary large" href="%s">%s</a>`, url, label)
		}
		buf.WriteString(`</div>`)
	case "section":
		fmt.Fprintf(buf, `<div class="builder-section"%s>`, style)
		for _, child := range block.Children {
			renderBlock(buf, child, ctx)
		}
		buf.WriteString(`</div>`)
	case "columns":
		columns := clampInt(propFloat(block.Props, "columns", float64(len(block.Children))), 1, 4)
		if columns <= 0 {
			columns = 2
		}
		gap := clampInt(propFloat(block.Props, "gap", 18), 0, 80)
		direction := safeFlexDirection(propString(block.Props, "direction", "row"))
		fmt.Fprintf(buf, `<div class="builder-columns" style="--builder-columns:%d;gap:%dpx;flex-direction:%s;%s">`, columns, gap, direction, safeInlineCSS(propString(block.Props, "custom_css", "")))
		for index := 0; index < columns; index++ {
			if index < len(block.Children) && block.Children[index].Type == "column" {
				renderBlock(buf, block.Children[index], ctx)
			} else {
				fmt.Fprintf(buf, `<div class="builder-column" style="flex-direction:column"></div>`)
			}
		}
		buf.WriteString(`</div>`)
	case "column":
		direction := safeFlexDirection(propString(block.Props, "flex_direction", "column"))
		gap := clampInt(propFloat(block.Props, "gap", 12), 0, 80)
		fmt.Fprintf(buf, `<div class="builder-column" style="flex-direction:%s;gap:%dpx;%s%s">`, direction, gap, columnStyleCSS(block.Props), safeInlineCSS(propString(block.Props, "custom_css", "")))
		for _, child := range block.Children {
			renderBlock(buf, child, ctx)
		}
		buf.WriteString(`</div>`)
	case "heading":
		level := safeHeading(propString(block.Props, "level", "h2"))
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", "Heading"), ctx))
		fmt.Fprintf(buf, `<%s%s>%s</%s>`, level, style, text, level)
	case "text":
		text := html.EscapeString(applyShortcodes(propString(block.Props, "text", "Text"), ctx))
		fmt.Fprintf(buf, `<p%s>%s</p>`, style, text)
	case "rich_text":
		text := renderRichText(propString(block.Props, "text", ""), ctx)
		fmt.Fprintf(buf, `<div%s%s>`, classAttr(block.Props, "rich-text"), style)
		buf.WriteString(text)
		buf.WriteString(`</div>`)
	case "html":
		text := renderRichText(propString(block.Props, "html", ""), ctx)
		fmt.Fprintf(buf, `<div class="rich-text builder-html-block"%s>`, style)
		buf.WriteString(text)
		buf.WriteString(`</div>`)
	case "image":
		url := safeURL(propString(block.Props, "url", ""))
		alt := html.EscapeString(propString(block.Props, "alt", ""))
		if url != "" {
			fmt.Fprintf(buf, `<figure%s><img src="%s" alt="%s"></figure>`, style, url, alt)
		}
	case "button":
		label := html.EscapeString(propString(block.Props, "label", "Learn more"))
		url := safeURL(propString(block.Props, "url", "#"))
		fmt.Fprintf(buf, `<p%s><a class="btn primary" href="%s"%s>%s</a></p>`, buttonWrapperStyleAttr(block.Props), url, typographyStyleAttr(block.Props, true), label)
	case "divider":
		fmt.Fprintf(buf, `<hr%s>`, style)
	case "spacer":
		height := clampInt(propFloat(block.Props, "height", 24), 8, 96)
		fmt.Fprintf(buf, `<div style="height:%dpx;%s"></div>`, height, safeInlineCSS(propString(block.Props, "custom_css", "")))
	case "video":
		url := safeVideoURL(propString(block.Props, "url", ""))
		if url != "" {
			fmt.Fprintf(buf, `<iframe class="video-embed" src="%s" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen%s></iframe>`, url, style)
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
	contact := firstNonEmpty(ctx.Settings.CompanyContact, ctx.Settings.SupportPhone, ctx.Settings.CompanyEmail)
	replacements := map[string]string{
		"[[site_name]]":       ctx.Settings.SiteName,
		"[[platform_name]]":   ctx.Settings.SiteName,
		"[[company_name]]":    ctx.Settings.SiteName,
		"[[company_slogan]]":  ctx.Settings.CompanySlogan,
		"[[slogan]]":          ctx.Settings.CompanySlogan,
		"[[company_email]]":   ctx.Settings.CompanyEmail,
		"[[company_contact]]": contact,
		"[[support_phone]]":   ctx.Settings.SupportPhone,
		"[[company_address]]": ctx.Settings.CompanyAddress,
		"[[owner_name]]":      ctx.Settings.OwnerName,
		"[[current_date]]":    time.Now().Format("January 2, 2006"),
	}
	for token, replacement := range replacements {
		value = strings.ReplaceAll(value, token, replacement)
	}
	return value
}

func renderRichText(value string, ctx RenderContext) string {
	safe := sanitizeRichText(applyShortcodes(value, ctx))
	return applyHTMLShortcodes(safe, ctx)
}

var allPricingShortcodePattern = regexp.MustCompile(`\[\[(?:pricing|pricing_list|all_pricing)\]\]`)
var singlePricingShortcodePattern = regexp.MustCompile(`\[\[(?:pricing|pricing_plan|price_list):([^\]]+)\]\]`)
var socialLinksShortcodePattern = regexp.MustCompile(`\[\[(?:social_links|company_socials|socialmedia_list)\]\]`)
var contactCardShortcodePattern = regexp.MustCompile(`\[\[(?:company_contact_card|contact_card)\]\]`)

func applyHTMLShortcodes(value string, ctx RenderContext) string {
	value = allPricingShortcodePattern.ReplaceAllString(value, renderPricingPlansHTML(ctx.Plans, ""))
	value = singlePricingShortcodePattern.ReplaceAllStringFunc(value, func(token string) string {
		matches := singlePricingShortcodePattern.FindStringSubmatch(token)
		if len(matches) < 2 {
			return ""
		}
		return renderPricingPlansHTML(ctx.Plans, matches[1])
	})
	value = socialLinksShortcodePattern.ReplaceAllString(value, renderSocialLinksHTML(ctx.Settings.SocialLinks))
	value = contactCardShortcodePattern.ReplaceAllString(value, renderContactCardHTML(ctx.Settings))
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

func styleAttr(props map[string]interface{}) string {
	style := typographyStyleCSS(props, false) + safeInlineCSS(propString(props, "custom_css", ""))
	if style == "" {
		return ""
	}
	return ` style="` + style + `"`
}

func buttonWrapperStyleAttr(props map[string]interface{}) string {
	style := textAlignCSS(props) + safeInlineCSS(propString(props, "custom_css", ""))
	if style == "" {
		return ""
	}
	return ` style="` + style + `"`
}

func typographyStyleAttr(props map[string]interface{}, skipAlign bool) string {
	style := typographyStyleCSS(props, skipAlign)
	if style == "" {
		return ""
	}
	return ` style="` + style + `"`
}

func typographyStyleCSS(props map[string]interface{}, skipAlign bool) string {
	parts := []string{}
	if color := safeHexColor(firstNonEmpty(propString(props, "font_color", ""), propString(props, "text_color", ""))); color != "" {
		parts = append(parts, "color:"+color)
	}
	if size := clampInt(propFloat(props, "font_size", 0), 0, 120); size > 0 {
		if size < 8 {
			size = 8
		}
		parts = append(parts, fmt.Sprintf("font-size:%dpx", size))
	}
	if family := safeFontFamily(propString(props, "font_family", "")); family != "" && family != "inherit" {
		parts = append(parts, "font-family:"+family)
	}
	spacing := propFloat(props, "letter_spacing", propFloat(props, "font_spacing", 0))
	if spacing != 0 {
		parts = append(parts, fmt.Sprintf("letter-spacing:%spx", formatCSSNumber(clampFloat(spacing, -2, 12))))
	}
	lineHeight := propFloat(props, "line_height", 0)
	if lineHeight > 0 {
		parts = append(parts, "line-height:"+formatCSSNumber(clampFloat(lineHeight, 0.8, 3)))
	}
	if !skipAlign {
		if align := safeTextAlign(propString(props, "text_align", "")); align != "" {
			parts = append(parts, "text-align:"+align)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, ";") + ";"
}

func textAlignCSS(props map[string]interface{}) string {
	if align := safeTextAlign(propString(props, "text_align", "")); align != "" {
		return "text-align:" + align + ";"
	}
	return ""
}

func columnStyleCSS(props map[string]interface{}) string {
	parts := []string{}
	borderStyle := safeBorderStyle(propString(props, "border_style", "none"))
	borderWidth := clampInt(propFloat(props, "border_width", 0), 0, 24)
	borderColor := safeHexColor(propString(props, "border_color", ""))
	if borderStyle != "none" && borderWidth <= 0 {
		borderWidth = 1
	}
	if borderStyle != "none" && borderWidth > 0 {
		parts = append(parts, "border-style:"+borderStyle)
		parts = append(parts, fmt.Sprintf("border-width:%dpx", borderWidth))
		if borderColor != "" {
			parts = append(parts, "border-color:"+borderColor)
		}
	}
	if radius := clampInt(propFloat(props, "border_radius", 0), 0, 80); radius > 0 {
		parts = append(parts, fmt.Sprintf("border-radius:%dpx", radius))
	}
	if background := safeHexColor(propString(props, "background_color", "")); background != "" {
		parts = append(parts, "background-color:"+background)
	}
	if textColor := safeHexColor(propString(props, "text_color", "")); textColor != "" {
		parts = append(parts, "color:"+textColor)
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, ";") + ";"
}

func classAttr(props map[string]interface{}, defaults ...string) string {
	classes := make([]string, 0, len(defaults)+4)
	for _, className := range defaults {
		if safeClassName(className) != "" {
			classes = append(classes, className)
		}
	}
	for _, className := range strings.Fields(propString(props, "class_name", "")) {
		if safe := safeClassName(className); safe != "" {
			classes = append(classes, safe)
		}
		if len(classes) >= 8 {
			break
		}
	}
	if len(classes) == 0 {
		return ""
	}
	return ` class="` + html.EscapeString(strings.Join(classes, " ")) + `"`
}

var safeClassNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func safeClassName(value string) string {
	value = strings.TrimSpace(value)
	if safeClassNamePattern.MatchString(value) {
		return value
	}
	return ""
}

func safeInlineCSS(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lower := strings.ToLower(value)
	blocked := []string{"<", ">", "{", "}", "javascript:", "expression(", "@import", "behavior:", "-moz-binding"}
	for _, needle := range blocked {
		if strings.Contains(lower, needle) {
			return ""
		}
	}
	return html.EscapeString(value)
}

func safeFlexDirection(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "row", "row-reverse", "column", "column-reverse":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "column"
	}
}

func safeFontFamily(value string) string {
	switch strings.TrimSpace(value) {
	case "inherit",
		"Inter, system-ui, sans-serif",
		"Arial, sans-serif",
		"Verdana, sans-serif",
		"Georgia, serif",
		"'Times New Roman', serif",
		"'Courier New', monospace",
		"Poppins, sans-serif",
		"Montserrat, sans-serif":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func safeTextAlign(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "left", "center", "right", "justify":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func clampFloat(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func formatCSSNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func safeBorderStyle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "solid", "dashed", "dotted", "double":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "none"
	}
}

var safeHexColorPattern = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func safeHexColor(value string) string {
	value = strings.TrimSpace(value)
	if safeHexColorPattern.MatchString(value) {
		return value
	}
	return ""
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

var allowedBasicTags = regexp.MustCompile(`&lt;(/?(?:div|strong|b|em|i|u|p|br|ul|ol|li|h1|h2|h3|h4|blockquote|code|pre|table|thead|tbody|tr|th|td)(?:\s*/?)?)&gt;`)
var allowedLinkOpenTag = regexp.MustCompile(`&lt;a\s+href=&#34;([^&#34;]+)&#34;(?:\s+[A-Za-z-]+=&#34;[^&#34;]*&#34;)*\s*&gt;`)
var allowedSpanColorOpenTag = regexp.MustCompile(`&lt;span\s+style=&#34;color:\s*(#[0-9a-fA-F]{3,6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))\s*;?&#34;&gt;`)
var allowedFontColorOpenTag = regexp.MustCompile(`&lt;font\s+color=&#34;(#[0-9a-fA-F]{3,6})&#34;&gt;`)

func sanitizeRichText(value string) string {
	escaped := html.EscapeString(value)
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	escaped = allowedBasicTags.ReplaceAllString(escaped, "<$1>")
	escaped = allowedSpanColorOpenTag.ReplaceAllString(escaped, `<span style="color:$1">`)
	escaped = allowedFontColorOpenTag.ReplaceAllString(escaped, `<span style="color:$1">`)
	escaped = strings.ReplaceAll(escaped, "&lt;/span&gt;", "</span>")
	escaped = strings.ReplaceAll(escaped, "&lt;/font&gt;", "</span>")
	escaped = strings.ReplaceAll(escaped, "&lt;/a&gt;", "</a>")
	return allowedLinkOpenTag.ReplaceAllStringFunc(escaped, func(match string) string {
		parts := allowedLinkOpenTag.FindStringSubmatch(match)
		if len(parts) < 2 {
			return ""
		}
		href := safeRichTextHref(html.UnescapeString(parts[1]))
		if href == "" {
			return ""
		}
		extra := ""
		if strings.HasPrefix(strings.ToLower(href), "http://") || strings.HasPrefix(strings.ToLower(href), "https://") {
			extra = ` target="_blank"`
		}
		return `<a href="` + href + `" rel="noopener"` + extra + `>`
	})
}

func safeRichTextHref(value string) string {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	if value == "" || strings.HasPrefix(lower, "javascript:") {
		return ""
	}
	if strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") ||
		strings.HasPrefix(value, "/") ||
		strings.HasPrefix(value, "#") {
		return html.EscapeString(value)
	}
	return ""
}

func renderPricingPlansHTML(plans []models.Plan, key string) string {
	selected := []models.Plan{}
	key = simpleSlug(key)
	for _, plan := range plans {
		if key == "" || planMatchesKey(plan, key) {
			selected = append(selected, plan)
		}
	}
	if len(selected) == 0 {
		return `<p class="muted">No matching pricing plan found.</p>`
	}
	var buf bytes.Buffer
	buf.WriteString(`<div class="pricing-grid shortcode-pricing-grid">`)
	for _, plan := range selected {
		featured := ""
		if plan.Featured {
			featured = ` class="featured"`
		}
		fmt.Fprintf(&buf, `<article%s>`, featured)
		fmt.Fprintf(&buf, `<h3>%s</h3>`, html.EscapeString(firstNonEmpty(plan.Name, "Plan")))
		fmt.Fprintf(&buf, `<p>%s</p>`, html.EscapeString(planPriceLine(plan, "monthly")))
		yearly := planPriceLine(plan, "yearly")
		if yearly != "" {
			fmt.Fprintf(&buf, `<strong>%s</strong>`, html.EscapeString(yearly))
		}
		if strings.TrimSpace(plan.Description) != "" {
			fmt.Fprintf(&buf, `<span>%s</span>`, html.EscapeString(plan.Description))
		}
		fmt.Fprintf(&buf, `<small>%s</small>`, html.EscapeString(planLimitsLine(plan)))
		if trial := planTrialLine(plan); trial != "" {
			fmt.Fprintf(&buf, `<em>%s</em>`, html.EscapeString(trial))
		}
		buf.WriteString(`</article>`)
	}
	buf.WriteString(`</div>`)
	return buf.String()
}

func planMatchesKey(plan models.Plan, key string) bool {
	return simpleSlug(plan.ID.Hex()) == key || simpleSlug(plan.Name) == key
}

func planPriceLine(plan models.Plan, period string) string {
	perSeat := plan.PricingModel == "per_seat"
	amount := plan.Price
	if perSeat {
		amount = plan.PricePerSeat
	}
	unit := "month"
	if period == "yearly" {
		unit = "year"
		if perSeat {
			amount = plan.PricePerSeatYearly
			if amount <= 0 {
				amount = plan.PricePerSeat * 12
			}
		} else {
			amount = plan.PriceYearly
			if amount <= 0 {
				amount = plan.Price * 12
			}
		}
	}
	if amount <= 0 {
		return "Contact us"
	}
	if perSeat {
		return fmt.Sprintf("%s / seat / %s", formatCentsUSD(amount), unit)
	}
	return fmt.Sprintf("%s / %s", formatCentsUSD(amount), unit)
}

func planLimitsLine(plan models.Plan) string {
	parts := []string{}
	if plan.SeatLimit > 0 {
		parts = append(parts, fmt.Sprintf("%d seats", plan.SeatLimit))
	}
	if plan.ProjectLimit > 0 {
		parts = append(parts, fmt.Sprintf("%d projects", plan.ProjectLimit))
	}
	if plan.StorageLimitMB > 0 {
		parts = append(parts, formatStorageLimit(plan.StorageLimitMB)+" storage")
	}
	if len(parts) == 0 {
		return "Custom limits"
	}
	return strings.Join(parts, " - ")
}

func planTrialLine(plan models.Plan) string {
	if plan.TrialDays <= 0 {
		return ""
	}
	if plan.TrialDays == 1 {
		return "1 day free trial"
	}
	return fmt.Sprintf("%d day free trial", plan.TrialDays)
}

func formatCentsUSD(cents int64) string {
	dollars := cents / 100
	remainder := cents % 100
	if remainder == 0 {
		return fmt.Sprintf("$%d", dollars)
	}
	return fmt.Sprintf("$%d.%02d", dollars, remainder)
}

func formatStorageLimit(mb int) string {
	if mb >= 1024 {
		gb := float64(mb) / 1024
		if gb == float64(int(gb)) {
			return fmt.Sprintf("%d GB", int(gb))
		}
		return fmt.Sprintf("%.1f GB", gb)
	}
	return fmt.Sprintf("%d MB", mb)
}

func renderSocialLinksHTML(items []models.SocialLink) string {
	links := []models.SocialLink{}
	for _, item := range items {
		if item.Visible && strings.TrimSpace(item.Label) != "" && strings.TrimSpace(item.URL) != "" {
			links = append(links, item)
		}
	}
	if len(links) == 0 {
		return ""
	}
	var buf bytes.Buffer
	buf.WriteString(`<div class="public-social-links">`)
	for _, item := range links {
		iconName := socialIconName(item.Icon)
		fmt.Fprintf(&buf, `<a class="public-social-link" href="%s" rel="noopener" target="_blank">`, safeURL(item.URL))
		fmt.Fprintf(&buf, `<i data-lucide="%s"></i><span>%s</span>`, iconName, html.EscapeString(item.Label))
		buf.WriteString(`</a>`)
	}
	buf.WriteString(`</div>`)
	return buf.String()
}

func renderContactCardHTML(settings models.SiteSettings) string {
	var buf bytes.Buffer
	contact := firstNonEmpty(settings.CompanyContact, settings.SupportPhone, settings.CompanyEmail)
	buf.WriteString(`<div class="public-contact-card">`)
	if strings.TrimSpace(settings.SiteName) != "" {
		fmt.Fprintf(&buf, `<h3>%s</h3>`, html.EscapeString(settings.SiteName))
	}
	if strings.TrimSpace(settings.CompanySlogan) != "" {
		fmt.Fprintf(&buf, `<p>%s</p>`, html.EscapeString(settings.CompanySlogan))
	}
	if strings.TrimSpace(settings.CompanyEmail) != "" {
		fmt.Fprintf(&buf, `<a href="mailto:%s"><i data-lucide="mail"></i>%s</a>`, html.EscapeString(settings.CompanyEmail), html.EscapeString(settings.CompanyEmail))
	}
	if strings.TrimSpace(contact) != "" && contact != settings.CompanyEmail {
		fmt.Fprintf(&buf, `<span><i data-lucide="phone"></i>%s</span>`, html.EscapeString(contact))
	}
	if social := renderSocialLinksHTML(settings.SocialLinks); social != "" {
		buf.WriteString(social)
	}
	buf.WriteString(`</div>`)
	return buf.String()
}

func socialIconName(icon string) string {
	switch strings.ToLower(strings.TrimSpace(icon)) {
	case "mail":
		return "mail"
	case "contact":
		return "contact"
	case "phone":
		return "phone"
	case "whatsapp":
		return "message-circle"
	case "facebook":
		return "facebook"
	case "instagram":
		return "instagram"
	case "tiktok":
		return "music-2"
	case "youtube":
		return "youtube"
	default:
		return "external-link"
	}
}

func simpleSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	})
	return strings.Join(fields, "-")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
