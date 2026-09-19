package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"html/template"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"bugmark/internal/billing"
	"bugmark/internal/config"
	"bugmark/internal/middleware"
	"bugmark/internal/models"
	"bugmark/internal/store"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestMarketplaceRules(t *testing.T) {
	for _, tc := range []struct{ at, want string }{
		{"2026-09-06T23:59:59Z", "2026-08-31T00:00:00Z"},
		{"2026-09-07T00:00:00Z", "2026-09-07T00:00:00Z"},
		{"2026-09-07T01:00:00+07:00", "2026-08-31T00:00:00Z"},
		{"2027-01-01T12:00:00Z", "2026-12-28T00:00:00Z"},
	} {
		at, _ := time.Parse(time.RFC3339, tc.at)
		if got := marketplaceWeek(at).Format(time.RFC3339); got != tc.want {
			t.Errorf("week(%s)=%s, want %s", tc.at, got, tc.want)
		}
	}
	for _, tc := range []struct{ gross, fee int64 }{{100, 5}, {101, 5}, {110, 6}, {10000, 500}, {maximumMarketplaceAmount, 500000}} {
		if got := marketplaceFee(tc.gross); got != tc.fee {
			t.Errorf("fee(%d)=%d", tc.gross, got)
		}
	}
	skills, err := normalizeMarketplaceSkills([]string{" php ", "PHP", "GoLang", " Custom   Specialty ", "custom specialty"})
	if err != nil || strings.Join(skills, ",") != "PHP,Golang,Custom Specialty" {
		t.Fatalf("skills: %v %v", skills, err)
	}
	if _, err = normalizeMarketplaceSkills(make([]string, 31)); err == nil {
		t.Error("too many skills accepted")
	}
	if _, err = normalizeMarketplaceSkills([]string{strings.Repeat("a", 61)}); err == nil {
		t.Error("oversized skill accepted")
	}
	if !validMarketplaceCountry("ID") || !validMarketplaceCountry("US") || validMarketplaceCountry("ZZ") || validMarketplaceCountry("id") {
		t.Error("invalid country validation")
	}
	p := models.FreelancerProfile{ID: primitive.NewObjectID(), Connects: 100, IdentityStatus: "pending", ConsentAt: time.Now()}
	public := publicFreelancer(p)
	for _, private := range []string{"connects", "connect_week", "identity_status", "consent_at", "consent_version", "email", "data"} {
		if _, exists := public[private]; exists {
			t.Errorf("private field exposed: %s", private)
		}
	}
}

func TestMarketplaceJobOwnerDetails(t *testing.T) {
	job := models.MarketplaceJob{
		ID:               primitive.NewObjectID(),
		OwnerID:          primitive.NewObjectID(),
		OwnerName:        "Alice Developer",
		OwnerTitle:       "Senior Software Architect",
		OwnerPhoto:       "https://example.test/photo.jpg",
		OwnerLocation:    "Berlin",
		OwnerCountry:     "DE",
		OwnerVerified:    true,
		OwnerRating:      5.0,
		OwnerRatingCount: 12,
		Title:            "Build Microservice",
		Budget:           50000,
		Status:           "open",
	}

	if job.OwnerName != "Alice Developer" || job.OwnerTitle != "Senior Software Architect" || job.OwnerLocation != "Berlin" || job.OwnerCountry != "DE" || !job.OwnerVerified || job.OwnerRating != 5.0 || job.OwnerRatingCount != 12 {
		t.Errorf("job owner details not correctly set: %+v", job)
	}

	data, err := json.Marshal(job)
	if err != nil {
		t.Fatalf("failed to marshal job: %v", err)
	}
	var unmarshaled models.MarketplaceJob
	if err := json.Unmarshal(data, &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal job: %v", err)
	}
	if unmarshaled.OwnerTitle != "Senior Software Architect" || !unmarshaled.OwnerVerified || unmarshaled.OwnerRating != 5.0 {
		t.Errorf("unmarshaled owner details mismatch: %+v", unmarshaled)
	}
}

func TestMarketplaceRoutesAndPrivateAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	router := gin.New()
	api := router.Group("/api")
	authed := api.Group("")
	authed.Use(func(c *gin.Context) { c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"}) })
	s.marketplaceRoutes(router, api, authed) // Detect route conflicts without needing a database.
	for _, route := range []string{"/api/marketplace/me", "/api/marketplace/identity/" + primitive.NewObjectID().Hex(), "/api/marketplace/wallet", "/api/marketplace/admin", "/api/marketplace/admin/identity", "/api/marketplace/jobs/" + primitive.NewObjectID().Hex() + "/work", "/api/marketplace/jobs/" + primitive.NewObjectID().Hex() + "/chat/" + primitive.NewObjectID().Hex(), "/api/marketplace/tasks/" + primitive.NewObjectID().Hex() + "/team"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", route, nil))
		if w.Code != 401 {
			t.Errorf("%s: %d", route, w.Code)
		}
	}
	wDirect := httptest.NewRecorder()
	router.ServeHTTP(wDirect, httptest.NewRequest("POST", "/api/marketplace/topup/direct", nil))
	if wDirect.Code != 401 {
		t.Errorf("direct topup expected 401, got %d", wDirect.Code)
	}
	// Public catalog now loads its configurable allowance from MongoDB.
	if _, err := template.ParseFiles(filepath.Join("..", "..", "web", "templates", "marketplace_privacy.gohtml")); err != nil {
		t.Fatal(err)
	}
	for _, feature := range []string{"tasks", "projects", "staff management", "time reports"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: primitive.NewObjectID(), Role: models.RoleMember})
		if !s.requireTeamFeatureAccess(c, primitive.NewObjectID(), feature) {
			t.Errorf("free feature blocked: %s", feature)
		}
	}
}

func TestWorkspaceHiringWalletResolution(t *testing.T) {
	s := &Server{}
	ctx := context.Background()
	userID := primitive.NewObjectID()

	// Case 1: Personal user (no team)
	personalCtx := middleware.UserContext{
		ID:   userID,
		Role: models.RoleTeamAdmin,
	}
	walletID, teamID, isWorkspace := s.resolveWorkspaceHiringWallet(ctx, personalCtx)
	if walletID != userID {
		t.Errorf("personal user must resolve to user ID, got %v", walletID)
	}
	if !teamID.IsZero() {
		t.Errorf("personal user must have zero team ID, got %v", teamID)
	}
	if isWorkspace {
		t.Error("personal user must not be marked as workspace")
	}

	// Case 2: Regular member (cannot spend from company wallet)
	memberTeamID := primitive.NewObjectID()
	memberCtx := middleware.UserContext{
		ID:     userID,
		Role:   models.RoleMember,
		TeamID: memberTeamID,
	}
	walletID, teamID, isWorkspace = s.resolveWorkspaceHiringWallet(ctx, memberCtx)
	if walletID != userID {
		t.Errorf("regular member must resolve to personal user ID, got %v", walletID)
	}
	if isWorkspace {
		t.Error("regular member must not have isWorkspace=true")
	}
}

type marketplaceTestPayments struct{}

func (marketplaceTestPayments) Name() string { return "paypal" }
func (marketplaceTestPayments) CreateCheckout(_ context.Context, r billing.CheckoutRequest) (billing.CheckoutSession, error) {
	return billing.CheckoutSession{ExternalID: "order-" + r.CustomID, URL: "https://www.paypal.com/checkoutnow?token=" + r.CustomID}, nil
}
func (marketplaceTestPayments) CaptureCheckout(_ context.Context, _ billing.CheckoutRequest, id string) (billing.PaymentCapture, error) {
	return billing.PaymentCapture{ExternalID: id, CaptureID: "capture-" + id, Status: "COMPLETED", Amount: 10000, Currency: "USD"}, nil
}
func (marketplaceTestPayments) HandleWebhook(context.Context, []byte, map[string]string) (string, error) {
	return "", nil
}
func (marketplaceTestPayments) RefundPayment(context.Context, string) error { return nil }

// Opt-in integration suite uses a fresh, uniquely named database on a replica
// set. No application users, existing database, mailer or live payments are used.
func TestMarketplaceIntegration(t *testing.T) {
	if os.Getenv("MARKETPLACE_INTEGRATION") != "1" {
		t.Skip("set MARKETPLACE_INTEGRATION=1 to run isolated MongoDB integration tests")
	}
	uri := os.Getenv("MARKETPLACE_TEST_URI")
	if uri == "" {
		t.Fatal("set MARKETPLACE_TEST_URI to an explicitly authorized test MongoDB; .env is never read")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(8*time.Second))
	if err != nil {
		t.Fatal("test database connection failed")
	}
	defer client.Disconnect(context.Background())
	if err = client.Ping(ctx, nil); err != nil {
		t.Fatal("test MongoDB unavailable (requires a reachable replica set)")
	}
	databaseName := "bugmark_mkt_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(databaseName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_mkt_") {
			if err := st.DB.Drop(cleanupCtx); err != nil {
				t.Error("could not remove isolated test database")
			}
		}
	}()
	if err = st.CreateIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	s := &Server{store: st, cfg: config.Config{AppURL: "http://localhost:8080"}, payments: map[string]billing.PaymentProvider{"paypal": marketplaceTestPayments{}}}
	if _, err = st.C("site_settings").InsertOne(ctx, models.SiteSettings{ID: primitive.NewObjectID(), PayPalEnabled: true, PayPalClientID: "test", PayPalClientSecret: "test"}); err != nil {
		t.Fatal(err)
	}
	boss := primitive.NewObjectID()
	freelancer := primitive.NewObjectID()
	other := primitive.NewObjectID()
	admin := primitive.NewObjectID()
	users := map[primitive.ObjectID]models.Role{boss: models.RoleTeamAdmin, freelancer: models.RoleMember, other: models.RoleMember, admin: models.RoleOwnerAdmin}
	for id, role := range users {
		_, err = st.C("users").InsertOne(ctx, models.User{ID: id, Name: "Test " + id.Hex(), Email: id.Hex() + "@example.test", EmailVerified: true, Status: models.StatusActive, Role: role})
		if err != nil {
			t.Fatal(err)
		}
		if err = s.ensureMarketplaceProfile(ctx, id); err != nil {
			t.Fatal(err)
		}
		_, err = st.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"title": "Web developer", "bio": "I build and maintain useful websites.", "country": "ID", "location": "Jakarta", "skills": []string{"PHP", "Custom Skill"}, "photo": userUploadURLPrefix(id) + "profile.png", "public": id != boss, "consent_version": marketplaceConsentVersion, "identity_status": "pending"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	authed := api.Group("")
	authed.Use(func(c *gin.Context) {
		id, _ := primitive.ObjectIDFromHex(c.GetHeader("X-Test-User"))
		role, ok := users[id]
		if !ok {
			c.AbortWithStatus(401)
			return
		}
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: id, Role: role})
		c.Next()
	})
	s.marketplaceRoutes(router, api, authed)
	request := func(user primitive.ObjectID, method, path string, body interface{}) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/marketplace"+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-User", user.Hex())
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	check := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("HTTP %d, want %d: %s", w.Code, status, w.Body.String())
		}
	}
	idFrom := func(w *httptest.ResponseRecorder, key string) string {
		t.Helper()
		var body map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		var item struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(body[key], &item); err != nil {
			t.Fatal(err)
		}
		return item.ID
	}
	wallet := func(id primitive.ObjectID) models.MarketplaceWallet {
		t.Helper()
		var w models.MarketplaceWallet
		err := st.C("marketplace_wallets").FindOne(ctx, bson.M{"_id": id}).Decode(&w)
		if err != nil {
			t.Fatal(err)
		}
		return w
	}
	profile := func(id primitive.ObjectID) models.FreelancerProfile {
		t.Helper()
		var p models.FreelancerProfile
		if err := st.C("freelancer_profiles").FindOne(ctx, bson.M{"_id": id}).Decode(&p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	jobBody := gin.H{"title": "Build a website", "description": "Build a responsive website and deliver the source code.", "skills": []string{"PHP"}, "budget": 10000}
	check(request(boss, "POST", "/jobs", jobBody), 400)
	check(request(boss, "POST", "/topup", gin.H{"amount": -10}), 400)
	check(request(boss, "POST", "/topup", gin.H{"amount": 1.5}), 400)
	check(request(boss, "POST", "/topup", gin.H{"amount": 10000}), 201)
	var topup models.MarketplaceTransfer
	if err = st.C("marketplace_transfers").FindOne(ctx, bson.M{"user_id": boss, "kind": "topup"}).Decode(&topup); err != nil {
		t.Fatal(err)
	}
	check(request(other, "POST", "/topup/"+topup.ID.Hex()+"/capture", gin.H{}), 409)
	check(request(boss, "POST", "/topup/"+topup.ID.Hex()+"/capture", gin.H{}), 200)
	check(request(boss, "POST", "/topup/"+topup.ID.Hex()+"/capture", gin.H{}), 200)
	if wallet(boss).Deposits != 10000 {
		t.Fatal("top-up replay duplicated funds")
	}
	w := request(boss, "POST", "/jobs", jobBody)
	check(w, 201)
	jobID := idFrom(w, "job")
	check(request(boss, "POST", "/jobs/"+jobID+"/proposals", gin.H{"price": 10000, "message": "I can complete this website for you."}), 400)
	proposalBody := gin.H{"price": 10000, "message": "I can complete this website for you."}
	w = request(freelancer, "POST", "/jobs/"+jobID+"/proposals", proposalBody)
	check(w, 201)
	proposalID := idFrom(w, "proposal")
	check(request(freelancer, "POST", "/jobs/"+jobID+"/proposals", proposalBody), 409)
	if profile(freelancer).Connects != 90 {
		t.Fatal("duplicate bid consumed Connects")
	}
	check(request(other, "GET", "/jobs/"+jobID, nil), 200)
	if strings.Contains(request(other, "GET", "/jobs/"+jobID, nil).Body.String(), proposalID) {
		t.Fatal("another freelancer can see private proposal")
	}
	check(request(other, "POST", "/proposals/"+proposalID+"/hire", gin.H{}), 400)
	// Two simultaneous hires must reserve the price once.
	var wg sync.WaitGroup
	responses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			responses <- request(boss, "POST", "/proposals/"+proposalID+"/hire", gin.H{}).Code
		}()
	}
	wg.Wait()
	close(responses)
	successes := 0
	for status := range responses {
		if status == 200 {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent hires succeeded %d times", successes)
	}
	if got := wallet(boss); got.Deposits != 0 || got.Reserved != 10000 {
		t.Fatalf("incorrect reserve: %+v", got)
	}
	if profile(freelancer).ActiveJobs != 1 {
		t.Fatal("availability not reserved")
	}
	if err = s.cleanupMarketplaceUser(ctx, freelancer); err == nil {
		t.Fatal("deleted active contractor")
	}
	check(request(boss, "POST", "/transfers", gin.H{"kind": "refund", "amount": 100, "destination": "original payment", "accept_fees": true}), 400)
	check(request(freelancer, "POST", "/jobs/"+jobID+"/approve", gin.H{"rating": 5}), 400)
	check(request(freelancer, "POST", "/jobs/"+jobID+"/submit", gin.H{"delivery": "Completed files are ready in our agreed delivery folder."}), 200)
	if strings.Contains(request(other, "GET", "/jobs/"+jobID, nil).Body.String(), "Completed files") {
		t.Fatal("delivery exposed to stranger")
	}
	check(request(boss, "POST", "/jobs/"+jobID+"/approve", gin.H{"rating": 6}), 400)
	check(request(boss, "POST", "/jobs/"+jobID+"/approve", gin.H{"rating": 5, "review": "Excellent work"}), 200)
	check(request(boss, "POST", "/jobs/"+jobID+"/approve", gin.H{"rating": 5}), 400)
	if got := wallet(freelancer); got.Pending != 9500 || got.Earnings != 0 {
		t.Fatalf("incorrect held earnings: %+v", got)
	}
	if p := profile(freelancer); p.Rating != 5 || p.RatingCount != 1 || p.ActiveJobs != 0 || p.FinishedJobs != 1 {
		t.Fatalf("incorrect completion stats: %+v", p)
	}
	oid, _ := primitive.ObjectIDFromHex(jobID)
	var job models.MarketplaceJob
	if err = st.C("marketplace_jobs").FindOne(ctx, bson.M{"_id": oid}).Decode(&job); err != nil {
		t.Fatal(err)
	}
	if job.AvailableAt.Sub(*job.ApprovedAt) != 7*24*time.Hour {
		t.Fatal("hold is not exactly seven days")
	}
	var imageBody bytes.Buffer
	multipartBody := multipart.NewWriter(&imageBody)
	part, err := multipartBody.CreateFormFile("file", "test-blank-image.png")
	if err != nil {
		t.Fatal(err)
	}
	if err = png.Encode(part, image.NewRGBA(image.Rect(0, 0, 100, 100))); err != nil {
		t.Fatal(err)
	}
	if err = multipartBody.WriteField("consent", "true"); err != nil {
		t.Fatal(err)
	}
	if err = multipartBody.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest := httptest.NewRequest("POST", "/api/marketplace/identity", &imageBody)
	uploadRequest.Header.Set("Content-Type", multipartBody.FormDataContentType())
	uploadRequest.Header.Set("X-Test-User", freelancer.Hex())
	uploadResponse := httptest.NewRecorder()
	router.ServeHTTP(uploadResponse, uploadRequest)
	check(uploadResponse, 200)
	check(request(admin, "POST", "/admin/identity/"+freelancer.Hex(), gin.H{"status": "verified", "revision": primitive.NewObjectID()}), 400)
	check(request(admin, "POST", "/admin/identity/"+freelancer.Hex(), gin.H{"status": "verified", "revision": profile(freelancer).IdentityRevision}), 200)
	privateImage := request(freelancer, "GET", "/identity/"+freelancer.Hex(), nil)
	check(privateImage, 200)
	if !strings.Contains(privateImage.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("private ID response is cacheable")
	}
	withdraw := gin.H{"kind": "withdrawal", "amount": 9500, "destination": "freelancer@example.test", "accept_fees": true}
	check(request(freelancer, "POST", "/transfers", withdraw), 400)
	_, err = st.C("marketplace_earnings").UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{"available_at": time.Now().Add(-time.Second)}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.marketplaceReleaseDueEarnings(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.marketplaceReleaseDueEarnings(ctx); err != nil {
		t.Fatal(err)
	}
	if got := wallet(freelancer); got.Pending != 0 || got.Earnings != 9500 {
		t.Fatalf("automatic release did not mature earnings exactly once: %+v", got)
	}
	w = request(freelancer, "POST", "/transfers", withdraw)
	check(w, 201)
	transferID := idFrom(w, "transfer")
	check(request(freelancer, "POST", "/transfers", withdraw), 400)
	check(request(other, "POST", "/admin/transfers/"+transferID, gin.H{"status": "paid", "reference": "test-payment"}), 403)
	check(request(admin, "POST", "/admin/transfers/"+transferID, gin.H{"status": "rejected"}), 200)
	check(request(admin, "POST", "/admin/transfers/"+transferID, gin.H{"status": "rejected"}), 409)
	if wallet(freelancer).Earnings != 9500 {
		t.Fatal("rejection failed to restore exactly once")
	}
	w = request(freelancer, "POST", "/transfers", withdraw)
	check(w, 201)
	transferID = idFrom(w, "transfer")
	check(request(admin, "POST", "/admin/transfers/"+transferID, gin.H{"status": "paid", "reference": "test-payment", "fee": 100}), 200)
	if w := wallet(freelancer); w.Earnings != 0 || w.Pending != 0 {
		t.Fatal("withdrawal balance incorrect")
	}
	// Public filters and identity authorization.
	check(request(other, "GET", "/identity/"+freelancer.Hex(), nil), 403)
	filtered := request(primitive.NilObjectID, "GET", "/freelancers?skill=Custom%20Skill&country=ID&rating=4&available=true", nil)
	check(filtered, 200)
	if !strings.Contains(filtered.Body.String(), freelancer.Hex()) || strings.Contains(filtered.Body.String(), "connects") {
		t.Fatal("public filtering or privacy failed")
	}
	_, err = st.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": other}, bson.M{"$set": bson.M{"connects": 0, "connect_week": marketplaceWeek(time.Now()).AddDate(0, 0, -7)}})
	if err != nil {
		t.Fatal(err)
	}
	check(request(other, "GET", "/me", nil), 200)
	if profile(other).Connects != 100 {
		t.Fatal("weekly grant not reset")
	}
	// Accepted/declined invitations are free; accepting never implicitly hires.
	_, err = st.C("marketplace_wallets").UpdateOne(ctx, bson.M{"_id": boss}, bson.M{"$set": bson.M{"deposits": 10000}})
	if err != nil {
		t.Fatal(err)
	}
	var invitationJobs []string
	for i := 0; i < 2; i++ {
		w = request(boss, "POST", "/jobs", jobBody)
		check(w, 201)
		invitationJobs = append(invitationJobs, idFrom(w, "job"))
	}
	for i, action := range []string{"accept", "decline"} {
		w = request(boss, "POST", "/jobs/"+invitationJobs[i]+"/proposals", gin.H{"price": 10000, "message": "Please help us build this website.", "freelancer_id": other.Hex()})
		check(w, 201)
		invitationID := idFrom(w, "proposal")
		check(request(boss, "POST", "/proposals/"+invitationID+"/"+action, gin.H{}), 400)
		check(request(other, "POST", "/proposals/"+invitationID+"/"+action, gin.H{}), 200)
		check(request(other, "POST", "/proposals/"+invitationID+"/"+action, gin.H{}), 400)
	}
	if profile(other).Connects != 100 || profile(other).ActiveJobs != 0 || wallet(boss).Reserved != 0 {
		t.Fatal("invitation consumed Connects or implicitly hired")
	}
	// Concurrent bids on separate jobs cannot spend the same last 10 Connects.
	_, err = st.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": other}, bson.M{"$set": bson.M{"connects": 10}})
	if err != nil {
		t.Fatal(err)
	}
	var quotaJobs []string
	for i := 0; i < 2; i++ {
		w = request(boss, "POST", "/jobs", jobBody)
		check(w, 201)
		quotaJobs = append(quotaJobs, idFrom(w, "job"))
	}
	quotaResults := make(chan int, 2)
	for _, quotaJob := range quotaJobs {
		wg.Add(1)
		go func(job string) {
			defer wg.Done()
			quotaResults <- request(other, "POST", "/jobs/"+job+"/proposals", proposalBody).Code
		}(quotaJob)
	}
	wg.Wait()
	close(quotaResults)
	successes = 0
	for status := range quotaResults {
		if status == 201 {
			successes++
		}
	}
	if successes != 1 || profile(other).Connects != 0 {
		t.Fatal("concurrent bids overspent Connects")
	}
	count, err := st.C("notifications").CountDocuments(ctx, bson.M{"user_id": other, "type": "marketplace_job"})
	if err != nil || count != 2 {
		t.Fatal("invitation notifications missing or duplicated")
	}
	// Consent withdrawal hides profile immediately.
	check(request(other, "PUT", "/admin/connects/policy", gin.H{"amount": 240, "period": "monthly"}), 403)
	check(request(admin, "PUT", "/admin/connects/policy", gin.H{"amount": -1, "period": "monthly"}), 400)
	check(request(admin, "PUT", "/admin/connects/policy", gin.H{"amount": 240, "period": "monthly"}), 200)
	before := profile(other).Connects
	check(request(other, "GET", "/me", nil), 200)
	if profile(other).Connects != before {
		t.Fatal("policy change overwrote current balance")
	}
	grantKey := primitive.NewObjectID().Hex()
	grant := gin.H{"user_ids": []string{other.Hex(), boss.Hex(), other.Hex()}, "amount": 25, "reason": "Test bonus", "request_id": grantKey}
	check(request(admin, "POST", "/admin/connects/grants", grant), 200)
	if profile(other).Connects != before+25 {
		t.Fatal("manual grant not added exactly once per unique user")
	}
	check(request(admin, "POST", "/admin/connects/grants", grant), 409)
	if profile(other).Connects != before+25 {
		t.Fatal("grant replay added duplicate credit")
	}
	check(request(admin, "POST", "/admin/connects/grants", gin.H{"user_ids": []string{other.Hex(), primitive.NewObjectID().Hex()}, "amount": 25, "reason": "Invalid target", "request_id": primitive.NewObjectID().Hex()}), 409)
	if profile(other).Connects != before+25 {
		t.Fatal("failed bulk grant partially applied")
	}
	monthStart, _ := connectsPeriod(time.Now(), "monthly")
	_, err = st.C("marketplace_settings").UpdateOne(ctx, bson.M{"_id": "connects"}, bson.M{"$set": bson.M{"updated_at": monthStart.Add(-time.Hour)}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.C("freelancer_profiles").UpdateOne(ctx, bson.M{"_id": other}, bson.M{"$set": bson.M{"connect_week": monthStart.AddDate(0, -1, 0)}})
	if err != nil {
		t.Fatal(err)
	}
	check(request(other, "GET", "/me", nil), 200)
	if profile(other).Connects != 240 {
		t.Fatal("monthly reset did not replace allowance and expired bonus")
	}
	check(request(admin, "POST", "/admin/connects/grants", gin.H{"user_ids": []string{other.Hex()}, "amount": 5, "reason": "Individual grant", "request_id": primitive.NewObjectID().Hex()}), 200)
	check(request(other, "GET", "/me", nil), 200)
	if profile(other).Connects != 245 {
		t.Fatal("repeated same-period reset lost manual grant")
	}
	p := profile(freelancer)
	check(request(freelancer, "PUT", "/profile", gin.H{"name": p.Name, "title": p.Title, "bio": p.Bio, "country": p.Country, "location": p.Location, "skills": p.Skills, "photo": p.Photo, "public": false, "consent": false}), 200)
	check(request(primitive.NilObjectID, "GET", "/freelancers/"+freelancer.Hex(), nil), 404)
	if err = s.cleanupMarketplaceUser(ctx, freelancer); err != nil {
		t.Fatal(err)
	}
	t.Run("hourly protected timer and unused reserve", func(t *testing.T) {
		if err := s.ensureMarketplaceProfile(ctx, freelancer); err != nil {
			t.Fatal(err)
		}
		_, err := st.C("freelancer_profiles").UpdateByID(ctx, freelancer, bson.M{"$set": bson.M{"active_jobs": 1}})
		if err != nil {
			t.Fatal(err)
		}
		_, err = st.C("marketplace_wallets").UpdateByID(ctx, boss, bson.M{"$set": bson.M{"deposits": 0, "reserved": 5000}})
		if err != nil {
			t.Fatal(err)
		}
		taskID := primitive.NewObjectID()
		if _, err = st.C("client_tasks").InsertOne(ctx, models.ClientTask{ID: taskID, Title: "Hourly task"}); err != nil {
			t.Fatal(err)
		}
		j := hourlyTestJob()
		j.ID = primitive.NewObjectID()
		j.OwnerID = boss
		j.FreelancerID = freelancer
		j.Status = "hired"
		j.Budget = 5000
		j.Price = 5000
		j.ScopeTasks[0].TaskID = taskID
		if _, err = st.C("marketplace_jobs").InsertOne(ctx, j); err != nil {
			t.Fatal(err)
		}
		path := "/jobs/" + j.ID.Hex()
		check(request(other, "POST", path+"/timer/start", gin.H{"task_id": taskID}), 400)
		check(request(boss, "POST", path+"/timer/start", gin.H{"task_id": taskID}), 400)
		check(request(freelancer, "POST", path+"/timer/start", gin.H{"task_id": primitive.NewObjectID()}), 400)
		check(request(freelancer, "POST", path+"/timer/start", gin.H{"task_id": taskID}), 200)
		check(request(freelancer, "POST", path+"/timer/start", gin.H{"task_id": taskID}), 200)
		second := j
		second.ID = primitive.NewObjectID()
		if _, err = st.C("marketplace_jobs").InsertOne(ctx, second); err != nil {
			t.Fatal(err)
		}
		check(request(freelancer, "POST", "/jobs/"+second.ID.Hex()+"/timer/start", gin.H{"task_id": taskID}), 400)
		start := time.Now().UTC().Add(-2 * time.Hour)
		deadline := start.Add(time.Hour)
		if _, err = st.C("marketplace_jobs").UpdateByID(ctx, j.ID, bson.M{"$set": bson.M{"timer_started_at": start, "timer_until": deadline}}); err != nil {
			t.Fatal(err)
		}
		check(request(freelancer, "POST", path+"/timer/stop", gin.H{}), 200)
		check(request(freelancer, "POST", path+"/timer/stop", gin.H{}), 200)
		var entry models.TimeEntry
		if err = st.C("time_entries").FindOne(ctx, bson.M{"marketplace_job_id": j.ID}).Decode(&entry); err != nil {
			t.Fatal(err)
		}
		if entry.DurationSeconds != 3600 {
			t.Fatal("deadline was not enforced")
		}
		count, err := st.C("time_entries").CountDocuments(ctx, bson.M{"marketplace_job_id": j.ID})
		if err != nil || count != 1 {
			t.Fatal("repeated stop duplicated time")
		}
		authed.PATCH("/marketplace/protected-time/:id", s.updateTimeEntry)
		authed.DELETE("/marketplace/protected-time/:id", s.deleteTimeEntry)
		check(request(freelancer, "PATCH", "/protected-time/"+entry.ID.Hex(), gin.H{"duration_minutes": 9999}), 403)
		check(request(admin, "DELETE", "/protected-time/"+entry.ID.Hex(), gin.H{}), 404)
		check(request(freelancer, "POST", path+"/submit", gin.H{"delivery": "The selected task is complete and ready for review."}), 200)
		check(request(freelancer, "POST", path+"/timer/start", gin.H{"task_id": taskID}), 400)
		check(request(boss, "POST", path+"/approve", gin.H{"rating": 5}), 200)
		check(request(boss, "POST", path+"/approve", gin.H{"rating": 5}), 400)
		var linkedTask struct {
			PaymentStatus    string             `bson:"payment_status"`
			MarketplaceJobID primitive.ObjectID `bson:"marketplace_job_id"`
		}
		if err = st.C("client_tasks").FindOne(ctx, bson.M{"_id": taskID}).Decode(&linkedTask); err != nil {
			t.Fatal(err)
		}
		if linkedTask.PaymentStatus != "pending" || linkedTask.MarketplaceJobID != j.ID {
			t.Fatalf("linked Find FH task did not reflect its pending marketplace payment: %+v", linkedTask)
		}
		if wallet(boss).Deposits != 2500 || wallet(boss).Reserved != 0 {
			t.Fatal("unused reserve was not returned exactly once")
		}
		if err = st.C("marketplace_jobs").FindOne(ctx, bson.M{"_id": j.ID}).Decode(&j); err != nil {
			t.Fatal(err)
		}
		if j.Price != 2500 || j.Fee != 125 || j.TrackedSeconds != 3600 {
			t.Fatal("incorrect hourly settlement")
		}
	})
	t.Log("Isolated marketplace lifecycle, concurrent hiring, wallet replay, privacy, hold, fee and settlement checks passed")
}

func TestLoadUserReviews(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_reviewstest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_reviewstest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}
	freelancerID := primitive.NewObjectID()
	reviewerID := primitive.NewObjectID()

	// 1. Initially empty
	reviews, err := s.loadUserReviews(ctx, freelancerID)
	if err != nil {
		t.Fatalf("loadUserReviews failed: %v", err)
	}
	if len(reviews) != 0 {
		t.Fatalf("expected 0 reviews, got %d", len(reviews))
	}

	// 2. Add client project and website
	projectID := primitive.NewObjectID()
	if _, err := st.C("client_projects").InsertOne(ctx, models.ClientProject{
		ID:   projectID,
		Name: "Client Project Alpha",
	}); err != nil {
		t.Fatalf("insert project: %v", err)
	}

	websiteID := primitive.NewObjectID()
	if _, err := st.C("client_websites").InsertOne(ctx, models.ClientWebsite{
		ID:       websiteID,
		ClientID: projectID,
		Name:     "E-Store",
	}); err != nil {
		t.Fatalf("insert website: %v", err)
	}

	// 3. Add client task review
	t1 := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	task := models.ClientTask{
		ID:        primitive.NewObjectID(),
		ClientID:  projectID,
		WebsiteID: websiteID,
		Title:     "Monthly Maintenance",
		Price:     125.50,
		UpdatedAt: t1,
		Ratings: []models.TaskRating{
			{
				FromUserID: reviewerID,
				ToUserID:   freelancerID,
				Role:       "admin",
				Rating:     5,
				Review:     "Great job on maintenance!",
				CreatedAt:  t1,
			},
		},
	}
	if _, err := st.C("client_tasks").InsertOne(ctx, task); err != nil {
		t.Fatalf("insert task: %v", err)
	}

	reviews, err = s.loadUserReviews(ctx, freelancerID)
	if err != nil || len(reviews) != 1 {
		t.Fatalf("expected 1 review, got %d (err=%v)", len(reviews), err)
	}
	if reviews[0].Title != "Monthly Maintenance" || reviews[0].Rating != 5 || reviews[0].Review != "Great job on maintenance!" {
		t.Fatalf("unexpected review content: %+v", reviews[0])
	}
	if reviews[0].ProjectName != "Client Project Alpha" {
		t.Fatalf("expected project name 'Client Project Alpha', got '%s'", reviews[0].ProjectName)
	}
	if reviews[0].Price == nil || *reviews[0].Price != 12550 {
		t.Fatalf("expected price 12550 cents, got %+v", reviews[0].Price)
	}
	if reviews[0].ApprovedAt == nil || !reviews[0].ApprovedAt.Equal(t1) {
		t.Fatalf("expected approved_at equal to t1, got %+v", reviews[0].ApprovedAt)
	}

	// 4. Add marketplace job completed review (newer)
	t2 := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	job := models.MarketplaceJob{
		ID:             primitive.NewObjectID(),
		FreelancerID:   freelancerID,
		Title:          "Landing page redesign",
		ScopeWebsiteID: websiteID,
		Price:          45000,
		Status:         "completed",
		Rating:         4,
		Review:         "Very fast turnaround.",
		ApprovedAt:     &t2,
		CreatedAt:      t2.Add(-24 * time.Hour),
	}
	if _, err := st.C("marketplace_jobs").InsertOne(ctx, job); err != nil {
		t.Fatalf("insert job: %v", err)
	}

	reviews, err = s.loadUserReviews(ctx, freelancerID)
	if err != nil || len(reviews) != 2 {
		t.Fatalf("expected 2 reviews, got %d (err=%v)", len(reviews), err)
	}
	// Newer first: Landing page redesign (t2) then Monthly Maintenance (t1)
	if reviews[0].Title != "Landing page redesign" || reviews[1].Title != "Monthly Maintenance" {
		t.Fatalf("reviews not sorted newest first: %+v", reviews)
	}
	if reviews[0].ProjectName != "Client Project Alpha" {
		t.Fatalf("expected job project name 'Client Project Alpha', got '%s'", reviews[0].ProjectName)
	}
	if reviews[0].Price == nil || *reviews[0].Price != 45000 {
		t.Fatalf("expected job price 45000, got %+v", reviews[0].Price)
	}

	// 4. Test marketplacePublicProfile handler returns profile and reviews
	u := models.User{
		ID:            freelancerID,
		Name:          "Test Freelancer",
		Status:        models.StatusActive,
		EmailVerified: true,
	}
	if _, err := st.C("users").InsertOne(ctx, u); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	prof := models.FreelancerProfile{
		ID:             freelancerID,
		Name:           "Test Freelancer",
		Public:         true,
		ConsentVersion: marketplaceConsentVersion,
		Rating:         4.5,
		RatingCount:    2,
	}
	if _, err := st.C("freelancer_profiles").InsertOne(ctx, prof); err != nil {
		t.Fatalf("insert profile: %v", err)
	}

	router := gin.New()
	router.GET("/marketplace/freelancers/:id", s.marketplacePublicProfile)

	req := httptest.NewRequest("GET", "/marketplace/freelancers/"+freelancerID.Hex(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Profile gin.H            `json:"profile"`
		Reviews []userReviewItem `json:"reviews"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Reviews) != 2 {
		t.Fatalf("expected 2 reviews in response, got %d", len(resp.Reviews))
	}
	if resp.Reviews[0].Title != "Landing page redesign" || resp.Reviews[1].Title != "Monthly Maintenance" {
		t.Fatalf("unexpected reviews in response: %+v", resp.Reviews)
	}
}

func TestFreelancerLanguages(t *testing.T) {
	validLangs := []models.FreelancerLanguage{
		{Language: "English", Level: "native"},
		{Language: "Indonesian", Level: "advance"},
		{Language: "Spanish", Level: "middle"},
		{Language: "French", Level: "basic"},
	}
	normalized, err := normalizeFreelancerLanguages(validLangs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(normalized) != 4 {
		t.Fatalf("expected 4 languages, got %d", len(normalized))
	}
	if normalized[0].Level != "native" || normalized[1].Level != "advance" || normalized[2].Level != "middle" || normalized[3].Level != "basic" {
		t.Fatalf("unexpected normalized levels: %+v", normalized)
	}

	invalidLangs := []models.FreelancerLanguage{
		{Language: "English", Level: "expert"},
	}
	if _, err := normalizeFreelancerLanguages(invalidLangs); err == nil {
		t.Fatal("expected error for invalid level 'expert', got nil")
	}

	emptyLangs := []models.FreelancerLanguage{
		{Language: "", Level: "basic"},
	}
	if _, err := normalizeFreelancerLanguages(emptyLangs); err == nil {
		t.Fatal("expected error for empty language name, got nil")
	}
}

func TestFreelancerAvailabilityDuration(t *testing.T) {
	val, err := normalizeAvailabilityDuration("")
	if err != nil || val != "" {
		t.Fatalf("expected empty result without error, got %q, %v", val, err)
	}

	val, err = normalizeAvailabilityDuration("more_than_30")
	if err != nil || val != "more_than_30" {
		t.Fatalf("expected 'more_than_30', got %q, %v", val, err)
	}

	val, err = normalizeAvailabilityDuration("  More than 30 hrs/week  ")
	if err != nil || val != "More than 30 hrs/week" {
		t.Fatalf("expected trimmed 'More than 30 hrs/week', got %q, %v", val, err)
	}

	tooLong := strings.Repeat("a", 61)
	if _, err := normalizeAvailabilityDuration(tooLong); err == nil {
		t.Fatal("expected error for duration > 60 chars, got nil")
	}
}

func TestFreelancerCertificates(t *testing.T) {
	validCerts := []models.FreelancerCertificate{
		{
			Name:          "Google Cloud Professional Cloud Architect",
			Issuer:        "Coursera / Google",
			IssueDate:     "2024",
			CredentialID:  "GCP-12345",
			CredentialURL: "https://coursera.org/verify/GCP12345",
		},
		{
			Name:   "Full Stack Web Development",
			Issuer: "Udemy",
		},
		{}, // blank row should be skipped
	}
	normalized, err := normalizeFreelancerCertificates(validCerts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(normalized) != 2 {
		t.Fatalf("expected 2 normalized certificates, got %d", len(normalized))
	}
	if normalized[0].Name != "Google Cloud Professional Cloud Architect" || normalized[0].CredentialURL != "https://coursera.org/verify/GCP12345" {
		t.Fatalf("unexpected normalized cert[0]: %+v", normalized[0])
	}

	missingIssuer := []models.FreelancerCertificate{
		{Name: "Some Course", Issuer: ""},
	}
	if _, err := normalizeFreelancerCertificates(missingIssuer); err == nil {
		t.Fatal("expected error for certificate missing issuer, got nil")
	}

	missingName := []models.FreelancerCertificate{
		{Name: "", Issuer: "Coursera"},
	}
	if _, err := normalizeFreelancerCertificates(missingName); err == nil {
		t.Fatal("expected error for certificate missing name, got nil")
	}

	invalidURL := []models.FreelancerCertificate{
		{Name: "Python Course", Issuer: "Coursera", CredentialURL: "javascript:alert(1)"},
	}
	if _, err := normalizeFreelancerCertificates(invalidURL); err == nil {
		t.Fatal("expected error for invalid credential URL, got nil")
	}

	tooMany := make([]models.FreelancerCertificate, 21)
	for i := range tooMany {
		tooMany[i] = models.FreelancerCertificate{Name: "Course", Issuer: "Platform"}
	}
	if _, err := normalizeFreelancerCertificates(tooMany); err == nil {
		t.Fatal("expected error for > 20 certificates, got nil")
	}
}

func TestFreelancerEducations(t *testing.T) {
	validEdus := []models.FreelancerEducation{
		{
			School:       "Stanford University",
			Degree:       "Bachelor of Science",
			FieldOfStudy: "Computer Science",
			StartYear:    "2018",
			EndYear:      "2022",
			Description:  "Graduated with honors in distributed systems.",
		},
		{
			School: "Online Tech Institute",
		},
		{}, // blank row should be skipped
	}
	normalized, err := normalizeFreelancerEducations(validEdus)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(normalized) != 2 {
		t.Fatalf("expected 2 normalized educations, got %d", len(normalized))
	}
	if normalized[0].School != "Stanford University" || normalized[0].Degree != "Bachelor of Science" {
		t.Fatalf("unexpected normalized edu[0]: %+v", normalized[0])
	}

	missingSchool := []models.FreelancerEducation{
		{Degree: "Bachelor of Science", FieldOfStudy: "Computer Science"},
	}
	if _, err := normalizeFreelancerEducations(missingSchool); err == nil {
		t.Fatal("expected error for education missing school, got nil")
	}

	tooMany := make([]models.FreelancerEducation, 21)
	for i := range tooMany {
		tooMany[i] = models.FreelancerEducation{School: "School"}
	}
	if _, err := normalizeFreelancerEducations(tooMany); err == nil {
		t.Fatal("expected error for > 20 educations, got nil")
	}
}

func TestMarketplaceProfileLanguagesAndHourlyJob(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := tryConnectTestMongo(ctx)
	if err != nil {
		t.Skipf("skipping MongoDB test: %v", err)
		return
	}
	defer client.Disconnect(context.Background())

	dbName := "bugmark_profiletest_" + primitive.NewObjectID().Hex()
	st := &store.Store{Client: client, DB: client.Database(dbName)}
	defer func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if strings.HasPrefix(st.DB.Name(), "bugmark_profiletest_") {
			_ = st.DB.Drop(cleanupCtx)
		}
	}()

	s := &Server{store: st}
	userID := primitive.NewObjectID()
	u := models.User{ID: userID, Name: "Dev Tester", Status: models.StatusActive, EmailVerified: true}
	_, _ = st.C("users").InsertOne(ctx, u)
	photoURL := userUploadURLPrefix(userID) + "photo.jpg"
	_, _ = st.C("freelancer_profiles").InsertOne(ctx, models.FreelancerProfile{
		ID:             userID,
		Name:           "Dev Tester",
		Photo:          photoURL,
		IdentityStatus: "verified",
		Skills:         []string{"Golang"},
	})
	_, _ = st.C("marketplace_wallets").InsertOne(ctx, models.MarketplaceWallet{
		ID:       userID,
		Deposits: 50000,
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	apiGroup := router.Group("/api")
	authed := apiGroup.Group("")
	authed.Use(func(c *gin.Context) {
		c.Set(middleware.UserContextKey, middleware.UserContext{ID: userID, Role: models.RoleMember})
		c.Next()
	})
	s.marketplaceRoutes(router, apiGroup, authed)

	// 1. Save profile with languages, availability duration, certificates, and educations
	profileReq := gin.H{
		"name":                  "Dev Tester",
		"title":                 "Backend Go Engineer",
		"bio":                   "Experienced Go backend developer building microservices and web APIs.",
		"country":               "US",
		"location":              "New York",
		"skills":                []string{"Golang", "MongoDB"},
		"photo":                 photoURL,
		"public":                true,
		"consent":               true,
		"availability_duration": "more_than_30",
		"languages": []gin.H{
			{"language": "English", "level": "native"},
			{"language": "Spanish", "level": "middle"},
		},
		"certificates": []gin.H{
			{
				"name":           "Google Cloud Certified",
				"issuer":         "Google",
				"issue_date":     "2024",
				"credential_url": "https://coursera.org/verify/123",
			},
		},
		"educations": []gin.H{
			{
				"school":         "Stanford University",
				"degree":         "Bachelor of Science",
				"field_of_study": "Computer Science",
				"start_year":     "2018",
				"end_year":       "2022",
			},
		},
	}
	raw, _ := json.Marshal(profileReq)
	req := httptest.NewRequest("PUT", "/api/marketplace/profile", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("save profile failed: HTTP %d: %s", w.Code, w.Body.String())
	}

	var updated models.FreelancerProfile
	if err := st.C("freelancer_profiles").FindOne(ctx, bson.M{"_id": userID}).Decode(&updated); err != nil {
		t.Fatalf("find profile failed: %v", err)
	}
	if len(updated.Languages) != 2 || updated.Languages[0].Language != "English" || updated.Languages[0].Level != "native" || updated.Languages[1].Level != "middle" {
		t.Fatalf("unexpected profile languages: %+v", updated.Languages)
	}
	if updated.AvailabilityDuration != "more_than_30" {
		t.Fatalf("unexpected availability duration: %s", updated.AvailabilityDuration)
	}
	if len(updated.Certificates) != 1 || updated.Certificates[0].Name != "Google Cloud Certified" || updated.Certificates[0].CredentialURL != "https://coursera.org/verify/123" {
		t.Fatalf("unexpected profile certificates: %+v", updated.Certificates)
	}
	if len(updated.Educations) != 1 || updated.Educations[0].School != "Stanford University" || updated.Educations[0].Degree != "Bachelor of Science" {
		t.Fatalf("unexpected profile educations: %+v", updated.Educations)
	}
	pub := publicFreelancer(updated)
	if pub["availability_duration"] != "more_than_30" {
		t.Fatalf("public freelancer missing availability_duration: %+v", pub)
	}
	certs, ok := pub["certificates"].([]models.FreelancerCertificate)
	if !ok || len(certs) != 1 {
		t.Fatalf("public freelancer certificates unexpected: %+v", pub["certificates"])
	}
	edus, ok := pub["educations"].([]models.FreelancerEducation)
	if !ok || len(edus) != 1 {
		t.Fatalf("public freelancer educations unexpected: %+v", pub["educations"])
	}

	// 2. Publish standalone hourly job
	hourlyJob := gin.H{
		"title":        "Build Go Microservice",
		"description":  "Need an experienced Go developer to build a robust microservice with unit tests.",
		"skills":       []string{"Golang"},
		"billing_type": "hourly",
		"hourly_rate":  3000,
		"max_seconds":  10 * 3600,
		"budget":       30000,
	}
	rawJob, _ := json.Marshal(hourlyJob)
	jobReq := httptest.NewRequest("POST", "/api/marketplace/jobs", bytes.NewReader(rawJob))
	jobReq.Header.Set("Content-Type", "application/json")
	wJob := httptest.NewRecorder()
	router.ServeHTTP(wJob, jobReq)
	if wJob.Code != 201 {
		t.Fatalf("create hourly job failed: HTTP %d: %s", wJob.Code, wJob.Body.String())
	}
}

