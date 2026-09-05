package handlers

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bugmark/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const marketplaceConsentVersion = "2026-09-05"
const proposalConnectCost = 10
const maximumMarketplaceAmount int64 = 10000000

var freelancerSkills = []string{"Web Developer", "PHP", "Laravel", "Golang", "WordPress", "Elementor", "Divi", "JavaScript", "TypeScript", "React", "Next.js", "Vue.js", "Angular", "Node.js", "Python", "Django", "Flask", "Ruby on Rails", "Java", "C#", ".NET", "HTML", "CSS", "Tailwind CSS", "Bootstrap", "SQL", "MySQL", "PostgreSQL", "MongoDB", "API Development", "Shopify", "WooCommerce", "Webflow", "Wix", "Squarespace", "Flutter", "React Native", "Android", "iOS", "Swift", "Kotlin", "UI/UX Design", "Figma", "Graphic Design", "Logo Design", "Illustration", "Video Editing", "Animation", "Copywriting", "Content Writing", "Technical Writing", "Translation", "SEO", "Social Media Marketing", "Email Marketing", "Google Ads", "Meta Ads", "Virtual Assistant", "Data Entry", "Customer Support", "Project Management", "QA Testing", "Manual Testing", "Test Automation", "DevOps", "AWS", "Docker", "Kubernetes", "Cybersecurity", "Data Analysis", "Machine Learning", "Bookkeeping"}

func marketplaceWeek(now time.Time) time.Time {
	now = now.UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -(int(day.Weekday())+6)%7)
}

func marketplaceFee(amount int64) int64 { return (amount*5 + 50) / 100 }

func normalizeMarketplaceSkills(values []string) ([]string, error) {
	if len(values) > 30 {
		return nil, errors.New("choose up to 30 skills")
	}
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.Join(strings.Fields(value), " ")
		if value == "" {
			continue
		}
		if len(value) > 60 {
			return nil, errors.New("each skill must be at most 60 characters")
		}
		for _, skill := range freelancerSkills {
			if strings.EqualFold(skill, value) {
				value = skill
				break
			}
		}
		key := strings.ToLower(value)
		if !seen[key] {
			result = append(result, value)
			seen[key] = true
		}
	}
	return result, nil
}

func (s *Server) marketplaceRoutes(router *gin.Engine, api, authed *gin.RouterGroup) {
	authed = authed.Group("")
	authed.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store, private")
		limit := int64(1 << 20)
		if c.Request.URL.Path == "/api/marketplace/identity" {
			limit = 6 << 20
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	})
	for _, path := range []string{"/inbox", "/freelancers", "/freelancers/:id", "/find-jobs", "/marketplace/jobs/:id", "/marketplace/jobs", "/wallet", "/admin/marketplace"} {
		router.GET(path, s.appPage)
	}
	router.GET("/marketplace/privacy", s.marketplacePrivacy)
	api.GET("/marketplace/skills", func(c *gin.Context) {
		policy, err := s.loadConnectsPolicy(c.Request.Context())
		if marketplaceError(c, err) {
			return
		}
		c.JSON(200, gin.H{"connects_policy": policy, "skills": freelancerSkills, "connect_cost": proposalConnectCost, "consent_version": marketplaceConsentVersion})
	})
	api.GET("/marketplace/freelancers", s.marketplaceFreelancers)
	api.GET("/marketplace/freelancers/:id", s.marketplacePublicProfile)
	api.GET("/marketplace/jobs", s.marketplaceJobs)
	authed.GET("/marketplace/me", s.marketplaceMe)
	authed.PUT("/marketplace/profile", s.marketplaceSaveProfile)
	authed.POST("/marketplace/identity", s.marketplaceUploadIdentity)
	authed.DELETE("/marketplace/identity", s.marketplaceDeleteIdentity)
	authed.GET("/marketplace/identity/:id", s.marketplaceReadIdentity)
	authed.GET("/marketplace/jobs/:id", s.marketplaceJob)
	authed.POST("/marketplace/jobs", s.marketplaceCreateJob)
	authed.POST("/marketplace/jobs/:id/proposals", s.marketplacePropose)
	authed.POST("/marketplace/jobs/:id/:action", s.marketplaceJobAction)
	authed.POST("/marketplace/proposals/:id/:action", s.marketplaceProposalAction)
	authed.GET("/marketplace/wallet", s.marketplaceWallet)
	authed.POST("/marketplace/topup", s.marketplaceTopup)
	authed.POST("/marketplace/topup/:id/capture", s.marketplaceCaptureTopup)
	authed.POST("/marketplace/transfers", s.marketplaceRequestTransfer)
	authed.GET("/marketplace/admin", s.marketplaceAdmin)
	authed.GET("/marketplace/admin/connects", s.adminConnects)
	authed.PUT("/marketplace/admin/connects/policy", s.saveConnectsPolicy)
	authed.POST("/marketplace/admin/connects/grants", s.grantConnects)
	authed.POST("/marketplace/admin/identity/:id", s.marketplaceReviewIdentity)
	authed.POST("/marketplace/admin/transfers/:id", s.marketplaceSettleTransfer)
}

// All multi-document financial and hiring changes commit atomically. A replica set
// (including Atlas) is required; never fall back to partial, nontransactional writes.
func (s *Server) marketplaceTransaction(ctx context.Context, fn func(mongo.SessionContext) error) error {
	session, err := s.store.Client.StartSession()
	if err != nil {
		return err
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(sc mongo.SessionContext) (interface{}, error) { return nil, fn(sc) })
	return err
}

func marketplaceError(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	// Do not return database internals or identity/payment data to clients.
	message := "Marketplace operation failed. Please retry."
	code := http.StatusInternalServerError
	if errors.Is(err, mongo.ErrNoDocuments) {
		message = "Record not found or action no longer available"
		code = 409
	}
	var invalid *marketplaceValidationError
	if errors.As(err, &invalid) {
		message = invalid.Error()
		code = 400
	}
	if mongo.IsDuplicateKeyError(err) {
		message = "This action was already submitted"
		code = 409
	}
	c.JSON(code, gin.H{"error": message})
	return true
}

type marketplaceValidationError struct{ message string }

func (e *marketplaceValidationError) Error() string { return e.message }
func marketInvalid(message string) error            { return &marketplaceValidationError{message} }

func (s *Server) marketplaceNotify(ctx context.Context, userID, relatedID primitive.ObjectID, kind, content string) error {
	_, err := s.store.C("notifications").InsertOne(ctx, models.Notification{ID: primitive.NewObjectID(), UserID: userID, RelatedID: relatedID, Type: kind, Content: content, CreatedAt: time.Now().UTC()})
	return err
}

func (s *Server) ensureMarketplaceProfile(ctx context.Context, id primitive.ObjectID) error {
	user, err := s.loadUser(ctx, id)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	policy, err := s.loadConnectsPolicy(ctx)
	if err != nil {
		return err
	}
	start, _ := connectsPeriod(now, policy.Period)
	_, err = s.store.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$setOnInsert": models.FreelancerProfile{ID: id, Name: user.Name, Skills: []string{}, IdentityStatus: "not_submitted", Connects: policy.Amount, ConnectWeek: start, UpdatedAt: now}}, options.Update().SetUpsert(true))
	if err != nil {
		return err
	}
	if !start.After(policy.UpdatedAt) {
		return nil
	}
	_, err = s.store.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": id, "connect_week": bson.M{"$lt": start}}, bson.M{"$set": bson.M{"connects": policy.Amount, "connect_week": start}})
	return err
}

func (s *Server) marketplaceMe(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	if marketplaceError(c, s.ensureMarketplaceProfile(ctx, user.ID)) {
		return
	}
	var profile models.FreelancerProfile
	if marketplaceError(c, s.store.C("freelancer_profiles").FindOne(ctx, bson.M{"_id": user.ID}).Decode(&profile)) {
		return
	}
	jobs := []models.MarketplaceJob{}
	cursor, err := s.store.C("marketplace_jobs").Find(ctx, bson.M{"$or": []bson.M{{"owner_id": user.ID}, {"freelancer_id": user.ID}}}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cursor.Close(ctx)
	if marketplaceError(c, cursor.All(ctx, &jobs)) {
		return
	}
	proposals := []models.MarketplaceProposal{}
	cur, err := s.store.C("marketplace_proposals").Find(ctx, bson.M{"freelancer_id": user.ID}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	if marketplaceError(c, cur.All(ctx, &proposals)) {
		return
	}
	policy, err := s.loadConnectsPolicy(ctx)
	if marketplaceError(c, err) {
		return
	}
	_, nextReset := connectsPeriod(time.Now(), policy.Period)
	c.JSON(200, gin.H{"connects_policy": policy, "profile": profile, "jobs": jobs, "proposals": proposals, "connect_cost": proposalConnectCost, "connects_reset_at": nextReset})
}

func (s *Server) marketplaceSaveProfile(c *gin.Context) {
	user, _ := currentUser(c)
	var req struct {
		Name     string   `json:"name"`
		Title    string   `json:"title"`
		Bio      string   `json:"bio"`
		Country  string   `json:"country"`
		Location string   `json:"location"`
		Skills   []string `json:"skills"`
		Photo    string   `json:"photo"`
		Public   bool     `json:"public"`
		Consent  bool     `json:"consent"`
	}
	if c.ShouldBindJSON(&req) != nil {
		marketplaceError(c, marketInvalid("Invalid profile"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Title = strings.TrimSpace(req.Title)
	req.Bio = strings.TrimSpace(req.Bio)
	req.Country = strings.ToUpper(strings.TrimSpace(req.Country))
	req.Location = strings.TrimSpace(req.Location)
	skills, err := normalizeMarketplaceSkills(req.Skills)
	if err != nil {
		marketplaceError(c, marketInvalid(err.Error()))
		return
	}
	if req.Name == "" || len(req.Name) > 100 || req.Title == "" || len(req.Title) > 120 || len(req.Bio) < 30 || len(req.Bio) > 5000 || !validMarketplaceCountry(req.Country) || req.Location == "" || len(req.Location) > 120 || len(skills) == 0 {
		marketplaceError(c, marketInvalid("Complete your name, professional title, bio (30–5000 characters), country, city and skills"))
		return
	}
	if req.Photo != "" && (!strings.HasPrefix(req.Photo, userUploadURLPrefix(user.ID)) || strings.Contains(req.Photo, "..") || strings.ContainsAny(req.Photo, "?#\\")) {
		marketplaceError(c, marketInvalid("Upload your own profile photo"))
		return
	}
	if req.Public && (!req.Consent || req.Photo == "") {
		marketplaceError(c, marketInvalid("A profile photo and public profile consent are required to publish"))
		return
	}
	ctx := c.Request.Context()
	if marketplaceError(c, s.ensureMarketplaceProfile(ctx, user.ID)) {
		return
	}
	set := bson.M{"name": req.Name, "title": req.Title, "bio": req.Bio, "country": req.Country, "location": req.Location, "skills": skills, "photo": req.Photo, "public": req.Public, "updated_at": time.Now().UTC()}
	if req.Public {
		set["consent_version"] = marketplaceConsentVersion
		set["consent_at"] = time.Now().UTC()
	}
	err = s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		_, err := s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": user.ID}, bson.M{"$set": set})
		if err != nil {
			return err
		}
		_, err = s.store.C("marketplace_consents").InsertOne(sc, bson.M{"user_id": user.ID, "version": marketplaceConsentVersion, "public": req.Public, "at": time.Now().UTC()})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

// ISO 3166-1 alpha-2 codes, validated on the server as well as in the country picker.
func validMarketplaceCountry(code string) bool {
	return len(code) == 2 && strings.Contains(" AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW ", " "+code+" ")
}

func publicFreelancer(p models.FreelancerProfile) gin.H {
	return gin.H{"id": p.ID, "name": p.Name, "title": p.Title, "bio": p.Bio, "country": p.Country, "location": p.Location, "skills": p.Skills, "photo": p.Photo, "rating": p.Rating, "rating_count": p.RatingCount, "finished_jobs": p.FinishedJobs, "published_jobs": p.PublishedJobs, "available": p.ActiveJobs == 0, "verified": p.IdentityStatus == "verified"}
}

func (s *Server) marketplaceFreelancers(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	filter := bson.M{"public": true, "consent_version": marketplaceConsentVersion}
	if skill := strings.TrimSpace(c.Query("skill")); skill != "" {
		filter["skills"] = bson.M{"$regex": "^" + regexp.QuoteMeta(skill) + "$", "$options": "i"}
	}
	if country := strings.ToUpper(c.Query("country")); country != "" {
		filter["country"] = country
	}
	if c.Query("available") == "true" {
		filter["active_jobs"] = 0
	}
	if rating := c.Query("rating"); rating != "" {
		n, err := strconv.ParseFloat(rating, 64)
		if err != nil || math.IsNaN(n) || n < 0 || n > 5 {
			marketplaceError(c, marketInvalid("Invalid rating"))
			return
		}
		filter["rating"] = bson.M{"$gte": n}
	}
	if raw := c.Query("finished_jobs"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 1000000 {
			marketplaceError(c, marketInvalid("Invalid completed job count"))
			return
		}
		filter["finished_jobs"] = bson.M{"$gte": n}
	}
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		page = 10000
	}
	ctx := c.Request.Context()
	// Join account status to avoid publishing suspended or deleted accounts.
	pipeline := mongo.Pipeline{{{Key: "$match", Value: filter}}, {{Key: "$lookup", Value: bson.M{"from": "users", "localField": "_id", "foreignField": "_id", "as": "account"}}}, {{Key: "$match", Value: bson.M{"account.status": bson.M{"$ne": models.StatusSuspended}, "account.email_verified": true, "account.0": bson.M{"$exists": true}}}}, {{Key: "$sort", Value: bson.D{{Key: "rating", Value: -1}, {Key: "_id", Value: 1}}}}, {{Key: "$skip", Value: (page - 1) * 24}}, {{Key: "$limit", Value: 25}}}
	cur, err := s.store.C("freelancer_profiles").Aggregate(ctx, pipeline)
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	profiles := []models.FreelancerProfile{}
	if marketplaceError(c, cur.All(ctx, &profiles)) {
		return
	}
	more := len(profiles) > 24
	if more {
		profiles = profiles[:24]
	}
	out := []gin.H{}
	for _, p := range profiles {
		out = append(out, publicFreelancer(p))
	}
	c.JSON(200, gin.H{"freelancers": out, "has_more": more, "page": page})
}

func (s *Server) marketplacePublicProfile(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	user, err := s.loadUser(ctx, id)
	if err != nil || user.Status == models.StatusSuspended || !user.EmailVerified {
		c.JSON(404, gin.H{"error": "Profile not found"})
		return
	}
	var p models.FreelancerProfile
	if err = s.store.C("freelancer_profiles").FindOne(ctx, bson.M{"_id": id, "public": true, "consent_version": marketplaceConsentVersion}).Decode(&p); err != nil {
		c.JSON(404, gin.H{"error": "Profile not found"})
		return
	}
	cur, err := s.store.C("marketplace_jobs").Find(ctx, bson.M{"freelancer_id": id, "status": "completed"}, options.Find().SetLimit(30).SetSort(bson.D{{Key: "approved_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	jobs := []models.MarketplaceJob{}
	if marketplaceError(c, cur.All(ctx, &jobs)) {
		return
	}
	reviews := []gin.H{}
	for _, j := range jobs {
		reviews = append(reviews, gin.H{"title": j.Title, "rating": j.Rating, "review": j.Review, "approved_at": j.ApprovedAt})
	}
	c.JSON(200, gin.H{"profile": publicFreelancer(p), "reviews": reviews})
}

func (s *Server) marketplaceUploadIdentity(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 6<<20)
	file, err := c.FormFile("file")
	if err != nil {
		marketplaceError(c, marketInvalid("Choose a JPEG or PNG ID image under 5 MB"))
		return
	}
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	stream, err := file.Open()
	if marketplaceError(c, err) {
		return
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, (5<<20)+1))
	if err != nil || len(data) > 5<<20 {
		marketplaceError(c, marketInvalid("ID image must be under 5 MB"))
		return
	}
	info, kind, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (kind != "jpeg" && kind != "png") || info.Width > 10000 || info.Height > 10000 || info.Width < 100 || info.Height < 100 || int64(info.Width)*int64(info.Height) > 16000000 {
		marketplaceError(c, marketInvalid("Invalid JPEG/PNG ID image"))
		return
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		marketplaceError(c, marketInvalid("ID image is incomplete or corrupt"))
		return
	}
	if c.PostForm("consent") != "true" {
		marketplaceError(c, marketInvalid("Acknowledge private identity processing before uploading"))
		return
	}
	if marketplaceError(c, s.ensureMarketplaceProfile(ctx, user.ID)) {
		return
	}
	revision := primitive.NewObjectID()
	err = s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		_, err := s.store.C("marketplace_identity").ReplaceOne(sc, bson.M{"_id": user.ID}, bson.M{"_id": user.ID, "revision": revision, "data": primitive.Binary{Subtype: 0, Data: data}, "mime": http.DetectContentType(data), "uploaded_at": time.Now().UTC(), "consent_version": marketplaceConsentVersion}, options.Replace().SetUpsert(true))
		if err != nil {
			return err
		}
		_, err = s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": user.ID}, bson.M{"$set": bson.M{"identity_status": "pending", "identity_revision": revision}})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"status": "pending"})
	}
}

func (s *Server) marketplaceReadIdentity(c *gin.Context) {
	user, _ := currentUser(c)
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	if user.ID != id && !s.marketplaceOwner(c) {
		return
	}
	var record struct {
		Data primitive.Binary `bson:"data"`
		MIME string           `bson:"mime"`
	}
	if marketplaceError(c, s.store.C("marketplace_identity").FindOne(c.Request.Context(), bson.M{"_id": id}).Decode(&record)) {
		return
	}
	c.Header("Cache-Control", "no-store, private")
	c.Header("Content-Disposition", "inline; filename=identity")
	s.audit(c.Request.Context(), user.ID, "identity_view", "user", id)
	c.Data(200, record.MIME, record.Data.Data)
}

func (s *Server) marketplaceDeleteIdentity(c *gin.Context) {
	user, _ := currentUser(c)
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		_, err := s.store.C("marketplace_identity").DeleteOne(sc, bson.M{"_id": user.ID})
		if err != nil {
			return err
		}
		_, err = s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": user.ID}, bson.M{"$set": bson.M{"identity_status": "not_submitted"}})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) marketplaceReady(ctx context.Context, id primitive.ObjectID, freelancer bool) (models.FreelancerProfile, error) {
	var p models.FreelancerProfile
	err := s.store.C("freelancer_profiles").FindOne(ctx, bson.M{"_id": id}).Decode(&p)
	if err != nil {
		return p, err
	}
	u, err := s.loadUser(ctx, id)
	if err != nil {
		return p, err
	}
	if u.Status == models.StatusSuspended || !u.EmailVerified || p.Title == "" || p.Bio == "" || p.Country == "" || len(p.Skills) == 0 || p.Photo == "" || (freelancer && (!p.Public || p.ConsentVersion != marketplaceConsentVersion)) || (p.IdentityStatus != "pending" && p.IdentityStatus != "verified") {
		return p, marketInvalid("Complete your profile, add a photo and submit your ID. Freelancers must also publish their profile with public-display consent")
	}
	return p, nil
}

func (s *Server) marketplaceJobs(c *gin.Context) {
	ctx := c.Request.Context()
	filter := bson.M{"status": "open"}
	if skill := strings.TrimSpace(c.Query("skill")); skill != "" {
		filter["skills"] = bson.M{"$regex": "^" + regexp.QuoteMeta(skill) + "$", "$options": "i"}
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if len(q) > 100 {
			q = q[:100]
		}
		filter["$or"] = []bson.M{{"title": bson.M{"$regex": regexp.QuoteMeta(q), "$options": "i"}}, {"description": bson.M{"$regex": regexp.QuoteMeta(q), "$options": "i"}}}
	}
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		page = 10000
	}
	cur, err := s.store.C("marketplace_jobs").Find(ctx, filter, options.Find().SetSkip(int64((page-1)*24)).SetLimit(25).SetSort(bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: 1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	jobs := []models.MarketplaceJob{}
	if marketplaceError(c, cur.All(ctx, &jobs)) {
		return
	}
	more := len(jobs) > 24
	if more {
		jobs = jobs[:24]
	}
	c.JSON(200, gin.H{"jobs": jobs, "has_more": more, "page": page})
}

func (s *Server) marketplaceCreateJob(c *gin.Context) {
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var req struct {
		SourceTaskID string   `json:"source_task_id"`
		Title        string   `json:"title"`
		Description  string   `json:"description"`
		Skills       []string `json:"skills"`
		Budget       int64    `json:"budget"`
	}
	if c.ShouldBindJSON(&req) != nil {
		marketplaceError(c, marketInvalid("Invalid job"))
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	skills, err := normalizeMarketplaceSkills(req.Skills)
	if err != nil || len(skills) == 0 || len(req.Title) < 5 || len(req.Title) > 160 || len(req.Description) < 30 || len(req.Description) > 10000 || req.Budget < 100 || req.Budget > maximumMarketplaceAmount {
		marketplaceError(c, marketInvalid("Enter a title, description (30–10000 characters), skills and a budget from $1 to $100,000"))
		return
	}
	job := models.MarketplaceJob{ID: primitive.NewObjectID(), OwnerID: user.ID, Title: req.Title, Description: req.Description, Skills: skills, Budget: req.Budget, Status: "open", CreatedAt: time.Now().UTC()}
	if req.SourceTaskID != "" {
		id, parseErr := primitive.ObjectIDFromHex(req.SourceTaskID)
		if parseErr != nil {
			marketplaceError(c, marketInvalid("Invalid source task"))
			return
		}
		var task models.ClientTask
		if err := s.store.C("client_tasks").FindOne(ctx, bson.M{"_id": id}).Decode(&task); err != nil || !s.canManageClientTask(ctx, user, task) {
			c.JSON(403, gin.H{"error": "You cannot offer this task to freelancers"})
			return
		}
		var site models.ClientWebsite
		if err := s.store.C("client_websites").FindOne(ctx, bson.M{"_id": task.WebsiteID}).Decode(&site); err != nil || !s.canAccessClientWebsite(ctx, user, site) {
			c.JSON(403, gin.H{"error": "You cannot offer this task to freelancers"})
			return
		}
		job.SourceTaskID = task.ID
	}
	err = s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		p, err := s.marketplaceReady(sc, user.ID, false)
		if err != nil {
			return err
		}
		job.OwnerName = p.Name
		var wallet models.MarketplaceWallet
		if err = s.store.C("marketplace_wallets").FindOne(sc, bson.M{"_id": user.ID, "deposits": bson.M{"$gte": req.Budget}}).Decode(&wallet); err != nil {
			return marketInvalid("Top up your balance to cover the job budget before publishing")
		}
		_, err = s.store.C("marketplace_jobs").InsertOne(sc, job)
		if err != nil {
			return err
		}
		_, err = s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": user.ID}, bson.M{"$inc": bson.M{"published_jobs": 1}})
		return err
	})
	if !marketplaceError(c, err) {
		c.JSON(201, gin.H{"job": job})
	}
}

func (s *Server) marketplaceJob(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var job models.MarketplaceJob
	if marketplaceError(c, s.store.C("marketplace_jobs").FindOne(ctx, bson.M{"_id": id}).Decode(&job)) {
		return
	}
	filter := bson.M{"job_id": id}
	if job.OwnerID != user.ID {
		filter["freelancer_id"] = user.ID
	}
	cur, err := s.store.C("marketplace_proposals").Find(ctx, filter, options.Find().SetLimit(200).SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if marketplaceError(c, err) {
		return
	}
	defer cur.Close(ctx)
	proposals := []models.MarketplaceProposal{}
	if marketplaceError(c, cur.All(ctx, &proposals)) {
		return
	}
	if job.OwnerID != user.ID && job.FreelancerID != user.ID {
		job.Delivery = ""
	}
	c.JSON(200, gin.H{"job": job, "proposals": proposals})
}

func (s *Server) marketplacePropose(c *gin.Context) {
	jobID, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	ctx := c.Request.Context()
	var req struct {
		Price        int64  `json:"price"`
		Message      string `json:"message"`
		FreelancerID string `json:"freelancer_id"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Price < 100 || req.Price > maximumMarketplaceAmount || len(strings.TrimSpace(req.Message)) < 20 || len(req.Message) > 5000 {
		marketplaceError(c, marketInvalid("Enter a price and a proposal message (20–5000 characters)"))
		return
	}
	target := user.ID
	kind := "bid"
	status := "submitted"
	if req.FreelancerID != "" {
		var err error
		target, err = primitive.ObjectIDFromHex(req.FreelancerID)
		if err != nil {
			marketplaceError(c, marketInvalid("Invalid freelancer"))
			return
		}
		kind = "invitation"
		status = "offered"
	}
	if marketplaceError(c, s.ensureMarketplaceProfile(ctx, target)) {
		return
	}
	proposal := models.MarketplaceProposal{ID: primitive.NewObjectID(), JobID: jobID, FreelancerID: target, Price: req.Price, Message: strings.TrimSpace(req.Message), Kind: kind, Status: status, CreatedAt: time.Now().UTC()}
	err := s.marketplaceTransaction(ctx, func(sc mongo.SessionContext) error {
		var job models.MarketplaceJob
		if err := s.store.C("marketplace_jobs").FindOne(sc, bson.M{"_id": jobID, "status": "open"}).Decode(&job); err != nil {
			return err
		}
		if target == job.OwnerID || (kind == "invitation" && job.OwnerID != user.ID) {
			return marketInvalid("You cannot apply to your own job or invite for another employer")
		}
		if _, err := s.marketplaceReady(sc, job.OwnerID, false); err != nil {
			return err
		}
		p, err := s.marketplaceReady(sc, target, true)
		if err != nil {
			return err
		}
		if p.ActiveJobs > 0 {
			return marketInvalid("Freelancer is currently working on a job")
		}
		proposal.Name = p.Name
		if kind == "bid" {
			result, err := s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": target, "connects": bson.M{"$gte": proposalConnectCost}}, bson.M{"$inc": bson.M{"connects": -proposalConnectCost}})
			if err != nil {
				return err
			}
			if result.ModifiedCount != 1 {
				return marketInvalid("Not enough Connects. Check your profile for the allowance and next reset date")
			}
		}
		// Write the job too, serializing proposal submission against hire/cancellation.
		_, err = s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": jobID}, bson.M{"$inc": bson.M{"proposal_revision": 1}})
		if err != nil {
			return err
		}
		_, err = s.store.C("marketplace_proposals").InsertOne(sc, proposal)
		if err != nil {
			return err
		}
		if kind == "invitation" {
			return s.marketplaceNotify(sc, target, jobID, "marketplace_job", "You received an offer for: "+job.Title)
		}
		return s.marketplaceNotify(sc, job.OwnerID, jobID, "marketplace_job", "A freelancer applied to: "+job.Title)
	})
	if !marketplaceError(c, err) {
		c.JSON(201, gin.H{"proposal": proposal})
	}
}

func (s *Server) marketplaceProposalAction(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	action := c.Param("action")
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		var p models.MarketplaceProposal
		if err := s.store.C("marketplace_proposals").FindOne(sc, bson.M{"_id": id}).Decode(&p); err != nil {
			return err
		}
		var j models.MarketplaceJob
		if err := s.store.C("marketplace_jobs").FindOne(sc, bson.M{"_id": p.JobID, "status": "open"}).Decode(&j); err != nil {
			return err
		}
		if action == "accept" || action == "decline" {
			if user.ID != p.FreelancerID || p.Status != "offered" {
				return marketInvalid("Only the invited freelancer can answer a pending offer")
			}
			status := "declined"
			if action == "accept" {
				if _, err := s.marketplaceReady(sc, user.ID, true); err != nil {
					return err
				}
				status = "accepted"
			}
			_, err := s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": j.ID}, bson.M{"$inc": bson.M{"proposal_revision": 1}})
			if err != nil {
				return err
			}
			_, err = s.store.C("marketplace_proposals").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": status}})
			if err != nil {
				return err
			}
			return s.marketplaceNotify(sc, j.OwnerID, j.ID, "marketplace_job", "Your offer was "+status+": "+j.Title)
		}
		if action != "hire" || j.OwnerID != user.ID || (p.Status != "submitted" && p.Status != "accepted") {
			return marketInvalid("Only the employer can hire an applicant or an accepted invitation")
		}
		if _, err := s.marketplaceReady(sc, user.ID, false); err != nil {
			return err
		}
		if _, err := s.marketplaceReady(sc, p.FreelancerID, true); err != nil {
			return err
		}
		result, err := s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": p.FreelancerID, "active_jobs": 0}, bson.M{"$inc": bson.M{"active_jobs": 1}})
		if err != nil {
			return err
		}
		if result.ModifiedCount != 1 {
			return marketInvalid("Freelancer is no longer available")
		}
		result, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": user.ID, "deposits": bson.M{"$gte": p.Price}}, bson.M{"$inc": bson.M{"deposits": -p.Price, "reserved": p.Price}})
		if err != nil {
			return err
		}
		if result.ModifiedCount != 1 {
			return marketInvalid("Top up your balance before hiring")
		}
		_, err = s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": j.ID}, bson.M{"$set": bson.M{"status": "hired", "freelancer_id": p.FreelancerID, "price": p.Price}})
		if err != nil {
			return err
		}
		_, err = s.store.C("marketplace_proposals").UpdateMany(sc, bson.M{"job_id": j.ID, "status": bson.M{"$in": []string{"submitted", "accepted", "offered"}}}, bson.M{"$set": bson.M{"status": "not_selected"}})
		if err != nil {
			return err
		}
		_, err = s.store.C("marketplace_proposals").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "hired"}})
		if err != nil {
			return err
		}
		return s.marketplaceNotify(sc, p.FreelancerID, j.ID, "marketplace_job", "You were hired for: "+j.Title+". Payment is reserved.")
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}

func (s *Server) marketplaceJobAction(c *gin.Context) {
	id, ok := objectIDParam(c, "id")
	if !ok {
		return
	}
	user, _ := currentUser(c)
	action := c.Param("action")
	var req struct {
		Delivery string `json:"delivery"`
		Rating   int    `json:"rating"`
		Review   string `json:"review"`
	}
	if c.ShouldBindJSON(&req) != nil {
		marketplaceError(c, marketInvalid("Invalid request"))
		return
	}
	err := s.marketplaceTransaction(c.Request.Context(), func(sc mongo.SessionContext) error {
		var j models.MarketplaceJob
		if err := s.store.C("marketplace_jobs").FindOne(sc, bson.M{"_id": id}).Decode(&j); err != nil {
			return err
		}
		switch action {
		case "cancel":
			if j.OwnerID != user.ID || j.Status != "open" {
				return marketInvalid("Only an open job can be cancelled")
			}
			_, err := s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "cancelled"}})
			if err != nil {
				return err
			}
			_, err = s.store.C("marketplace_proposals").UpdateMany(sc, bson.M{"job_id": id}, bson.M{"$set": bson.M{"status": "cancelled"}})
			return err
		case "submit":
			if j.FreelancerID != user.ID || j.Status != "hired" || len(strings.TrimSpace(req.Delivery)) < 20 || len(req.Delivery) > 10000 {
				return marketInvalid("Only the hired freelancer can submit work; include delivery details (20–10000 characters)")
			}
			_, err := s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "submitted", "delivery": strings.TrimSpace(req.Delivery)}})
			if err != nil {
				return err
			}
			return s.marketplaceNotify(sc, j.OwnerID, j.ID, "marketplace_job", "Work is ready for your approval: "+j.Title)
		case "revise":
			if j.OwnerID != user.ID || j.Status != "submitted" {
				return marketInvalid("Only the employer can request changes to submitted work")
			}
			_, err := s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "hired"}})
			if err != nil {
				return err
			}
			return s.marketplaceNotify(sc, j.FreelancerID, j.ID, "marketplace_job", "Changes were requested for: "+j.Title)
		case "approve":
			if j.OwnerID != user.ID || j.Status != "submitted" || req.Rating < 1 || req.Rating > 5 || len(req.Review) > 2000 {
				return marketInvalid("Only the employer can approve submitted work; choose a rating from 1 to 5")
			}
			now := time.Now().UTC()
			available := now.Add(7 * 24 * time.Hour)
			fee := marketplaceFee(j.Price)
			net := j.Price - fee
			result, err := s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": user.ID, "reserved": bson.M{"$gte": j.Price}}, bson.M{"$inc": bson.M{"reserved": -j.Price}})
			if err != nil {
				return err
			}
			if result.ModifiedCount != 1 {
				return marketInvalid("Reserved funds unavailable; contact support")
			}
			_, err = s.store.C("marketplace_wallets").UpdateOne(sc, bson.M{"_id": j.FreelancerID}, bson.M{"$inc": bson.M{"pending": net}}, options.Update().SetUpsert(true))
			if err != nil {
				return err
			}
			_, err = s.store.C("marketplace_earnings").InsertOne(sc, bson.M{"_id": j.ID, "user_id": j.FreelancerID, "amount": net, "fee": fee, "available_at": available, "status": "pending"})
			if err != nil {
				return err
			}
			_, err = s.store.C("marketplace_jobs").UpdateOne(sc, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "completed", "fee": fee, "rating": req.Rating, "review": strings.TrimSpace(req.Review), "approved_at": now, "available_at": available}})
			if err != nil {
				return err
			}
			var p models.FreelancerProfile
			err = s.store.C("freelancer_profiles").FindOneAndUpdate(sc, bson.M{"_id": j.FreelancerID}, bson.M{"$inc": bson.M{"active_jobs": -1, "finished_jobs": 1, "rating_total": req.Rating, "rating_count": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&p)
			if err != nil {
				return err
			}
			_, err = s.store.C("freelancer_profiles").UpdateOne(sc, bson.M{"_id": p.ID}, bson.M{"$set": bson.M{"rating": float64(p.RatingTotal) / float64(p.RatingCount)}})
			if err != nil {
				return err
			}
			return s.marketplaceNotify(sc, j.FreelancerID, j.ID, "marketplace_job", "Payment approved for: "+j.Title+". Your earnings unlock in seven days.")
		}
		return marketInvalid("Unknown action")
	})
	if !marketplaceError(c, err) {
		c.JSON(200, gin.H{"ok": true})
	}
}
