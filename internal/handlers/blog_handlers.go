package handlers

import (
	"bytes"
	"context"
	"fmt"
	"html"
	template "html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"
	"bugmark/internal/pagebuilder"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const blogPageSize = 9

type blogPostInput struct {
	Title            string   `json:"title"`
	Slug             string   `json:"slug"`
	Excerpt          string   `json:"excerpt"`
	Content          string   `json:"content"`
	FeaturedImageURL string   `json:"featured_image_url"`
	CategoryIDs      []string `json:"category_ids"`
	TagIDs           []string `json:"tag_ids"`
	Status           string   `json:"status"`
}

func (s *Server) adminBlogPosts(c *gin.Context) {
	userCtx, _ := currentUser(c)
	_ = s.ensureEditableBlogPage(c.Request.Context(), userCtx.ID)
	filter := bson.M{}
	if status := strings.TrimSpace(c.Query("status")); status == "draft" || status == "published" {
		filter["status"] = status
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		pattern := regexp.QuoteMeta(q)
		filter["$or"] = []bson.M{{"title": bson.M{"$regex": pattern, "$options": "i"}}, {"excerpt": bson.M{"$regex": pattern, "$options": "i"}}}
	}
	cursor, err := s.store.C("blog_posts").Find(c.Request.Context(), filter, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(500))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load blog posts"})
		return
	}
	defer cursor.Close(c.Request.Context())
	posts := []models.BlogPost{}
	if err := cursor.All(c.Request.Context(), &posts); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode blog posts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"posts": posts})
}

func (s *Server) ensureEditableBlogPage(ctx context.Context, userID primitive.ObjectID) error {
	count, err := s.store.C("static_pages").CountDocuments(ctx, bson.M{"slug": "blog"})
	if err != nil || count > 0 {
		return err
	}
	now := time.Now()
	page := models.StaticPage{
		ID:        primitive.NewObjectID(),
		Slug:      "blog",
		Title:     "Blog",
		PageWidth: "1180px",
		Status:    "draft",
		Blocks: []models.PageBlock{
			{ID: primitive.NewObjectID().Hex(), Type: "section_heading", Props: map[string]interface{}{"eyebrow": "Insights", "heading": "Blog", "text": "Latest articles and updates."}},
			{ID: primitive.NewObjectID().Hex(), Type: "rich_text", Props: map[string]interface{}{"text": "[[blog_grid]]"}},
		},
		Versions:  []models.PageVersion{},
		UpdatedBy: userID,
		UpdatedAt: now,
	}
	_, err = s.store.C("static_pages").InsertOne(ctx, page)
	if mongo.IsDuplicateKeyError(err) {
		return nil
	}
	return err
}

func (s *Server) adminCreateBlogPost(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req blogPostInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid blog post"})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}
	slug := slugify(firstNonEmpty(req.Slug, title))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid title or slug"})
		return
	}
	now := time.Now()
	post := models.BlogPost{ID: primitive.NewObjectID(), Title: title, Slug: slug, Status: "draft", CategoryIDs: []primitive.ObjectID{}, TagIDs: []primitive.ObjectID{}, AuthorID: userCtx.ID, CreatedAt: now, UpdatedAt: now}
	if _, err := s.store.C("blog_posts").InsertOne(c.Request.Context(), post); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "a post with this slug already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create blog post"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"post": post})
}

func (s *Server) adminGetBlogPost(c *gin.Context) {
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	var post models.BlogPost
	if err := s.store.C("blog_posts").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&post); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "blog post not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"post": post})
}

func (s *Server) adminUpdateBlogPost(c *gin.Context) {
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	var req blogPostInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid blog post"})
		return
	}
	title := strings.TrimSpace(req.Title)
	slug := slugify(firstNonEmpty(req.Slug, title))
	if title == "" || slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title and a valid slug are required"})
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "published" {
		status = "draft"
	}
	categoryIDs, err := blogObjectIDs(req.CategoryIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "one or more categories are invalid"})
		return
	}
	tagIDs, err := blogObjectIDs(req.TagIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "one or more tags are invalid"})
		return
	}
	set := bson.M{
		"title": title, "slug": slug, "excerpt": strings.TrimSpace(req.Excerpt), "content": req.Content,
		"featured_image_url": safeBlogMediaURL(req.FeaturedImageURL), "category_ids": categoryIDs, "tag_ids": tagIDs,
		"status": status, "updated_at": time.Now(),
	}
	if status == "published" {
		var existing models.BlogPost
		if err := s.store.C("blog_posts").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&existing); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "blog post not found"})
			return
		}
		if existing.PublishedAt == nil {
			set["published_at"] = time.Now()
		}
	}
	res, err := s.store.C("blog_posts").UpdateByID(c.Request.Context(), id, bson.M{"$set": set})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "a post with this slug already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save blog post"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "blog post not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true, "slug": slug, "status": status})
}

func (s *Server) adminDeleteBlogPost(c *gin.Context) {
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	res, err := s.store.C("blog_posts").DeleteOne(c.Request.Context(), bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete blog post"})
		return
	}
	if res.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "blog post not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

type blogTaxonomyInput struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
}

func (s *Server) adminBlogCategories(c *gin.Context) {
	cursor, err := s.store.C("blog_categories").Find(c.Request.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load categories"})
		return
	}
	defer cursor.Close(c.Request.Context())
	items := []models.BlogCategory{}
	if err := cursor.All(c.Request.Context(), &items); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": items})
}

func (s *Server) adminCreateBlogCategory(c *gin.Context) { s.saveBlogCategory(c, false) }
func (s *Server) adminUpdateBlogCategory(c *gin.Context) { s.saveBlogCategory(c, true) }

func (s *Server) saveBlogCategory(c *gin.Context, updating bool) {
	var req blogTaxonomyInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category"})
		return
	}
	name, slug := strings.TrimSpace(req.Name), slugify(firstNonEmpty(req.Slug, req.Name))
	if name == "" || slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category name is required"})
		return
	}
	now := time.Now()
	if !updating {
		item := models.BlogCategory{ID: primitive.NewObjectID(), Name: name, Slug: slug, Description: strings.TrimSpace(req.Description), CreatedAt: now, UpdatedAt: now}
		if _, err := s.store.C("blog_categories").InsertOne(c.Request.Context(), item); err != nil {
			blogTaxonomyWriteError(c, err, "category")
			return
		}
		c.JSON(http.StatusCreated, gin.H{"category": item})
		return
	}
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	res, err := s.store.C("blog_categories").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"name": name, "slug": slug, "description": strings.TrimSpace(req.Description), "updated_at": now}})
	if err != nil {
		blogTaxonomyWriteError(c, err, "category")
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

func (s *Server) adminDeleteBlogCategory(c *gin.Context) {
	s.deleteBlogTaxonomy(c, "blog_categories", "category_ids", "category")
}

func (s *Server) adminBlogTags(c *gin.Context) {
	cursor, err := s.store.C("blog_tags").Find(c.Request.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load tags"})
		return
	}
	defer cursor.Close(c.Request.Context())
	items := []models.BlogTag{}
	if err := cursor.All(c.Request.Context(), &items); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not decode tags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": items})
}

func (s *Server) adminCreateBlogTag(c *gin.Context) { s.saveBlogTag(c, false) }
func (s *Server) adminUpdateBlogTag(c *gin.Context) { s.saveBlogTag(c, true) }

func (s *Server) saveBlogTag(c *gin.Context, updating bool) {
	var req blogTaxonomyInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag"})
		return
	}
	name, slug := strings.TrimSpace(req.Name), slugify(firstNonEmpty(req.Slug, req.Name))
	if name == "" || slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tag name is required"})
		return
	}
	now := time.Now()
	if !updating {
		item := models.BlogTag{ID: primitive.NewObjectID(), Name: name, Slug: slug, CreatedAt: now, UpdatedAt: now}
		if _, err := s.store.C("blog_tags").InsertOne(c.Request.Context(), item); err != nil {
			blogTaxonomyWriteError(c, err, "tag")
			return
		}
		c.JSON(http.StatusCreated, gin.H{"tag": item})
		return
	}
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	res, err := s.store.C("blog_tags").UpdateByID(c.Request.Context(), id, bson.M{"$set": bson.M{"name": name, "slug": slug, "updated_at": now}})
	if err != nil {
		blogTaxonomyWriteError(c, err, "tag")
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

func (s *Server) adminDeleteBlogTag(c *gin.Context) {
	s.deleteBlogTaxonomy(c, "blog_tags", "tag_ids", "tag")
}

func (s *Server) deleteBlogTaxonomy(c *gin.Context, collection, postField, label string) {
	id, ok := blogObjectID(c)
	if !ok {
		return
	}
	res, err := s.store.C(collection).DeleteOne(c.Request.Context(), bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete " + label})
		return
	}
	if res.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": label + " not found"})
		return
	}
	_, _ = s.store.C("blog_posts").UpdateMany(c.Request.Context(), bson.M{postField: id}, bson.M{"$pull": bson.M{postField: id}})
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func blogTaxonomyWriteError(c *gin.Context, err error, label string) {
	if mongo.IsDuplicateKeyError(err) {
		c.JSON(http.StatusConflict, gin.H{"error": "a " + label + " with this slug already exists"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save " + label})
}

func blogObjectID(c *gin.Context) (primitive.ObjectID, bool) {
	id, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return primitive.NilObjectID, false
	}
	return id, true
}

func blogObjectIDs(values []string) ([]primitive.ObjectID, error) {
	ids := make([]primitive.ObjectID, 0, len(values))
	seen := map[primitive.ObjectID]bool{}
	for _, value := range values {
		id, err := primitive.ObjectIDFromHex(strings.TrimSpace(value))
		if err != nil {
			return nil, err
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	return ids, nil
}

func safeBlogMediaURL(value string) string {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	if value == "" || strings.HasPrefix(value, "/uploads/") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") {
		return value
	}
	return ""
}

func (s *Server) publicBlogIndex(c *gin.Context) {
	page := positiveBlogPage(c.Query("page"))
	category, tag := slugify(c.Query("category")), slugify(c.Query("tag"))
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	renderCtx := pagebuilder.RenderContext{Settings: settings, Plans: s.pageBuilderPlans(c.Request.Context()), PageWidth: "1180px"}
	renderCtx.BlogGridHTML = s.renderBlogGridHTML(c.Request.Context(), page, category, tag)
	var pageModel models.StaticPage
	var body string
	if err := s.store.C("static_pages").FindOne(c.Request.Context(), bson.M{"slug": "blog", "status": "published"}).Decode(&pageModel); err == nil {
		renderCtx.PageWidth = safePublicPageWidth(firstNonEmpty(pageModel.PageWidth, "1180px"))
		body = pagebuilder.Render(pageModel.Blocks, renderCtx)
	} else {
		body = `<section class="legal-section builder-public-page"><div class="builder-section-head"><p class="eyebrow">Insights</p><h1>Blog</h1><p>Latest articles and updates.</p></div>` + renderCtx.BlogGridHTML + `</section>`
	}
	c.HTML(http.StatusOK, "legal.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": "Blog", "HTML": template.HTML(body), "Year": time.Now().Year(), "PageWidth": renderCtx.PageWidth}))
}

func (s *Server) publicBlogPost(c *gin.Context) {
	slug := slugify(c.Param("slug"))
	var post models.BlogPost
	if err := s.store.C("blog_posts").FindOne(c.Request.Context(), bson.M{"slug": slug, "status": "published"}).Decode(&post); err != nil {
		s.publicBlogNotFound(c)
		return
	}
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	renderCtx := pagebuilder.RenderContext{Settings: settings, Plans: s.pageBuilderPlans(c.Request.Context()), PageWidth: "920px"}
	var buf bytes.Buffer
	buf.WriteString(`<article class="legal-section blog-article"><a class="blog-back-link" href="/blog">&larr; All articles</a>`)
	if post.FeaturedImageURL != "" {
		fmt.Fprintf(&buf, `<img class="blog-article-cover" src="%s" alt="">`, html.EscapeString(post.FeaturedImageURL))
	}
	fmt.Fprintf(&buf, `<header><h1>%s</h1>`, html.EscapeString(post.Title))
	if post.PublishedAt != nil {
		fmt.Fprintf(&buf, `<p class="blog-date">%s</p>`, html.EscapeString(post.PublishedAt.Format("January 2, 2006")))
	}
	categoryNames := map[primitive.ObjectID]string{}
	for _, item := range s.blogCategories(c.Request.Context()) {
		categoryNames[item.ID] = item.Name
	}
	tagNames := map[primitive.ObjectID]string{}
	for _, item := range s.blogTags(c.Request.Context()) {
		tagNames[item.ID] = item.Name
	}
	if labels := blogPostLabels(post, categoryNames, tagNames); labels != "" {
		buf.WriteString(labels)
	}
	buf.WriteString(`</header><div class="rich-text blog-article-content">`)
	buf.WriteString(pagebuilder.RenderRichText(post.Content, renderCtx))
	buf.WriteString(`</div></article>`)
	c.HTML(http.StatusOK, "legal.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": post.Title, "HTML": template.HTML(buf.String()), "Year": time.Now().Year(), "PageWidth": renderCtx.PageWidth}))
}

func (s *Server) publicBlogNotFound(c *gin.Context) {
	settings, _ := s.loadSiteSettings(c.Request.Context())
	settings = s.settingsWithConfigFallback(settings)
	c.HTML(http.StatusNotFound, "legal.gohtml", s.withPublicPageChrome(settings, gin.H{"Title": "Article not found", "HTML": template.HTML(`<section class="legal-section"><h1>Article not found</h1><p>The article may be unpublished or no longer available.</p><a class="btn" href="/blog">View all articles</a></section>`), "Year": time.Now().Year(), "PageWidth": "840px"}))
}

func positiveBlogPage(value string) int64 {
	page, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || page < 1 {
		return 1
	}
	if page > 10000 {
		return 10000
	}
	return page
}

func (s *Server) renderBlogGridHTML(ctx context.Context, page int64, categorySlug, tagSlug string) string {
	filter := bson.M{"status": "published"}
	categories := s.blogCategories(ctx)
	tags := s.blogTags(ctx)
	if categorySlug != "" {
		if id, ok := categoryIDBySlug(categories, categorySlug); ok {
			filter["category_ids"] = id
		} else {
			filter["_id"] = primitive.NilObjectID
		}
	}
	if tagSlug != "" {
		if id, ok := tagIDBySlug(tags, tagSlug); ok {
			filter["tag_ids"] = id
		} else {
			filter["_id"] = primitive.NilObjectID
		}
	}
	total, _ := s.store.C("blog_posts").CountDocuments(ctx, filter)
	pages := (total + blogPageSize - 1) / blogPageSize
	if pages > 0 && page > pages {
		page = pages
	}
	if page < 1 {
		page = 1
	}
	cursor, err := s.store.C("blog_posts").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "published_at", Value: -1}, {Key: "created_at", Value: -1}}).SetSkip((page-1)*blogPageSize).SetLimit(blogPageSize))
	posts := []models.BlogPost{}
	if err == nil {
		defer cursor.Close(ctx)
		_ = cursor.All(ctx, &posts)
	}
	categoryNames := map[primitive.ObjectID]string{}
	for _, item := range categories {
		categoryNames[item.ID] = item.Name
	}
	tagNames := map[primitive.ObjectID]string{}
	for _, item := range tags {
		tagNames[item.ID] = item.Name
	}
	var buf bytes.Buffer
	buf.WriteString(`<div class="blog-browser">`)
	if len(categories) > 0 || len(tags) > 0 {
		buf.WriteString(`<nav class="blog-filters" aria-label="Article filters"><a class="blog-filter" href="/blog">All</a>`)
		for _, item := range categories {
			className := "blog-filter"
			if item.Slug == categorySlug {
				className += " active"
			}
			fmt.Fprintf(&buf, `<a class="%s" href="/blog?category=%s">%s</a>`, className, url.QueryEscape(item.Slug), html.EscapeString(item.Name))
		}
		for _, item := range tags {
			className := "blog-filter blog-filter-tag"
			if item.Slug == tagSlug {
				className += " active"
			}
			fmt.Fprintf(&buf, `<a class="%s" href="/blog?tag=%s">#%s</a>`, className, url.QueryEscape(item.Slug), html.EscapeString(item.Name))
		}
		buf.WriteString(`</nav>`)
	}
	if len(posts) == 0 {
		buf.WriteString(`<div class="blog-empty"><h2>No articles found</h2><p>Published articles will appear here.</p></div>`)
	} else {
		buf.WriteString(`<div class="blog-grid">`)
		for _, post := range posts {
			buf.WriteString(`<article class="blog-card">`)
			if post.FeaturedImageURL != "" {
				fmt.Fprintf(&buf, `<a class="blog-card-image" href="/blog/%s"><img src="%s" alt="" loading="lazy"></a>`, url.PathEscape(post.Slug), html.EscapeString(post.FeaturedImageURL))
			}
			buf.WriteString(`<div class="blog-card-body">`)
			if post.PublishedAt != nil {
				fmt.Fprintf(&buf, `<time datetime="%s">%s</time>`, post.PublishedAt.Format("2006-01-02"), html.EscapeString(post.PublishedAt.Format("January 2, 2006")))
			}
			fmt.Fprintf(&buf, `<h2><a href="/blog/%s">%s</a></h2>`, url.PathEscape(post.Slug), html.EscapeString(post.Title))
			excerpt := strings.TrimSpace(post.Excerpt)
			if excerpt == "" {
				excerpt = blogExcerpt(post.Content)
			}
			if excerpt != "" {
				fmt.Fprintf(&buf, `<p>%s</p>`, html.EscapeString(excerpt))
			}
			if labels := blogPostLabels(post, categoryNames, tagNames); labels != "" {
				buf.WriteString(labels)
			}
			fmt.Fprintf(&buf, `<a class="blog-read-more" href="/blog/%s">Read article &rarr;</a></div></article>`, url.PathEscape(post.Slug))
		}
		buf.WriteString(`</div>`)
	}
	if pages > 1 {
		buf.WriteString(`<nav class="blog-pagination" aria-label="Article pages">`)
		for number := int64(1); number <= pages; number++ {
			className := "blog-page-link"
			if number == page {
				className += " active"
			}
			query := url.Values{}
			query.Set("page", strconv.FormatInt(number, 10))
			if categorySlug != "" {
				query.Set("category", categorySlug)
			}
			if tagSlug != "" {
				query.Set("tag", tagSlug)
			}
			fmt.Fprintf(&buf, `<a class="%s" href="/blog?%s"%s>%d</a>`, className, html.EscapeString(query.Encode()), currentPageARIA(number == page), number)
		}
		buf.WriteString(`</nav>`)
	}
	buf.WriteString(`</div>`)
	return buf.String()
}

func currentPageARIA(active bool) string {
	if active {
		return ` aria-current="page"`
	}
	return ""
}

func (s *Server) blogCategories(ctx context.Context) []models.BlogCategory {
	cursor, err := s.store.C("blog_categories").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return []models.BlogCategory{}
	}
	defer cursor.Close(ctx)
	items := []models.BlogCategory{}
	_ = cursor.All(ctx, &items)
	return items
}

func (s *Server) blogTags(ctx context.Context) []models.BlogTag {
	cursor, err := s.store.C("blog_tags").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return []models.BlogTag{}
	}
	defer cursor.Close(ctx)
	items := []models.BlogTag{}
	_ = cursor.All(ctx, &items)
	return items
}

func categoryIDBySlug(items []models.BlogCategory, slug string) (primitive.ObjectID, bool) {
	for _, item := range items {
		if item.Slug == slug {
			return item.ID, true
		}
	}
	return primitive.NilObjectID, false
}

func tagIDBySlug(items []models.BlogTag, slug string) (primitive.ObjectID, bool) {
	for _, item := range items {
		if item.Slug == slug {
			return item.ID, true
		}
	}
	return primitive.NilObjectID, false
}

func blogPostLabels(post models.BlogPost, categories, tags map[primitive.ObjectID]string) string {
	var labels []string
	for _, id := range post.CategoryIDs {
		if name := categories[id]; name != "" {
			labels = append(labels, `<span>`+html.EscapeString(name)+`</span>`)
		}
	}
	for _, id := range post.TagIDs {
		if name := tags[id]; name != "" {
			labels = append(labels, `<span>#`+html.EscapeString(name)+`</span>`)
		}
	}
	if len(labels) == 0 {
		return ""
	}
	return `<div class="blog-card-labels">` + strings.Join(labels, "") + `</div>`
}

var blogHTMLTagPattern = regexp.MustCompile(`<[^>]*>`)

func blogExcerpt(content string) string {
	value := html.UnescapeString(blogHTMLTagPattern.ReplaceAllString(content, " "))
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 180 {
		return string(runes[:177]) + "..."
	}
	return value
}

func pageContainsBlogGrid(blocks []models.PageBlock) bool {
	for _, block := range blocks {
		for _, value := range block.Props {
			if text, ok := value.(string); ok && (strings.Contains(text, "[[blog_grid]]") || strings.Contains(text, "[[articles_grid]]")) {
				return true
			}
		}
		if pageContainsBlogGrid(block.Children) {
			return true
		}
	}
	return false
}
