package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

const (
	googleAuthURL     = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL    = "https://oauth2.googleapis.com/token"
	googleUserInfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"
)

type googleOAuthState struct {
	Mode     string `json:"mode"`
	Invite   string `json:"invite,omitempty"`
	IssuedAt int64  `json:"issued_at"`
	Nonce    string `json:"nonce"`
}

type googleUserInfo struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

type googleTwoFactorChallenge struct {
	UserID   string `json:"user_id"`
	Subject  string `json:"sub"`
	IssuedAt int64  `json:"issued_at"`
	Expires  int64  `json:"expires"`
	Nonce    string `json:"nonce"`
}

type googleOAuthRuntimeConfig struct {
	Enabled      bool
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

func (s *Server) googleAuthStart(c *gin.Context) {
	oauthConfig := s.googleOAuthRuntimeConfig(c.Request.Context())
	if !oauthConfig.Configured() {
		s.socialAuthError(c, "Google login is not configured yet. Add Google credentials in Platform Settings.")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("mode", "login")))
	if mode != "register" {
		mode = "login"
	}
	state, err := s.signGoogleOAuthState(googleOAuthState{
		Mode:     mode,
		Invite:   strings.TrimSpace(c.Query("invite")),
		IssuedAt: time.Now().Unix(),
		Nonce:    mustRandomStateNonce(),
	})
	if err != nil {
		s.socialAuthError(c, "Could not start Google login.")
		return
	}
	values := url.Values{}
	values.Set("client_id", oauthConfig.ClientID)
	values.Set("redirect_uri", oauthConfig.RedirectURL)
	values.Set("response_type", "code")
	values.Set("scope", "openid email profile")
	values.Set("state", state)
	values.Set("prompt", "select_account")
	c.Redirect(http.StatusFound, googleAuthURL+"?"+values.Encode())
}

func (s *Server) googleAuthCallback(c *gin.Context) {
	if errText := strings.TrimSpace(c.Query("error")); errText != "" {
		s.socialAuthError(c, "Google login was canceled or denied: "+errText)
		return
	}
	state, err := s.verifyGoogleOAuthState(strings.TrimSpace(c.Query("state")))
	if err != nil {
		s.socialAuthError(c, "Google login state is invalid or expired.")
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		s.socialAuthError(c, "Google did not return an authorization code.")
		return
	}
	oauthConfig := s.googleOAuthRuntimeConfig(c.Request.Context())
	if !oauthConfig.Configured() {
		s.socialAuthError(c, "Google login is not configured yet.")
		return
	}
	info, err := s.fetchGoogleUserInfo(c.Request.Context(), code, oauthConfig)
	if err != nil {
		s.socialAuthError(c, err.Error())
		return
	}
	if !info.EmailVerified {
		s.socialAuthError(c, "Google account email must be verified before signing in.")
		return
	}
	if s.googleAccountNeedsRegistration(c.Request.Context(), info.Email) && !s.allowRegistrationAttempt(c) {
		return
	}
	user, created, err := s.findOrCreateGoogleUser(c.Request.Context(), info, state)
	if err != nil {
		s.socialAuthError(c, err.Error())
		return
	}
	if user.Status == models.StatusSuspended {
		s.socialAuthError(c, "This account is suspended.")
		return
	}
	if user.TwoFactorEnabled {
		challenge, err := s.signGoogleTwoFactorChallenge(user, info.Subject)
		if err != nil {
			s.socialAuthError(c, "Could not create authenticator challenge.")
			return
		}
		s.socialAuthTwoFactor(c, challenge)
		return
	}
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		s.socialAuthError(c, "Could not issue login tokens.")
		return
	}
	_, _ = s.store.C("users").UpdateByID(c.Request.Context(), user.ID, bson.M{"$set": bson.M{"last_active_at": time.Now()}})
	s.socialAuthSuccess(c, access, refresh, created)
}

func (s *Server) googleAccountNeedsRegistration(ctx context.Context, email string) bool {
	err := s.store.C("users").FindOne(ctx, bson.M{"email": strings.ToLower(strings.TrimSpace(email))}).Err()
	return err == mongo.ErrNoDocuments
}

func (s *Server) googleAuthVerifyTwoFactor(c *gin.Context) {
	var req struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid authenticator body"})
		return
	}
	challenge, err := s.verifyGoogleTwoFactorChallenge(req.Challenge)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Google login challenge expired. Please sign in again."})
		return
	}
	userID, err := primitive.ObjectIDFromHex(challenge.UserID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid Google login challenge"})
		return
	}
	user, err := s.loadUser(c.Request.Context(), userID)
	if err != nil || user.Status == models.StatusSuspended {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "account is not available"})
		return
	}
	if !user.TwoFactorEnabled || !auth.VerifyTOTP(user.TwoFactorSecret, req.Code, time.Now()) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authenticator code"})
		return
	}
	access, refresh, err := s.issueTokens(c.Request.Context(), user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue login tokens"})
		return
	}
	_, _ = s.store.C("users").UpdateByID(c.Request.Context(), user.ID, bson.M{"$set": bson.M{"last_active_at": time.Now()}})
	c.JSON(http.StatusOK, gin.H{"access_token": access, "refresh_token": refresh})
}

func (s *Server) googleOAuthRuntimeConfig(ctx context.Context) googleOAuthRuntimeConfig {
	settings, _ := s.loadSiteSettings(ctx)
	settings = s.settingsWithConfigFallback(settings)
	return googleOAuthRuntimeConfig{
		Enabled:      settings.GoogleSigninEnabled,
		ClientID:     strings.TrimSpace(settings.GoogleClientID),
		ClientSecret: strings.TrimSpace(settings.GoogleClientSecret),
		RedirectURL:  strings.TrimSpace(settings.GoogleRedirectURL),
	}
}

func (cfg googleOAuthRuntimeConfig) Configured() bool {
	return cfg.Enabled && cfg.ClientID != "" && cfg.ClientSecret != "" && cfg.RedirectURL != ""
}

func (s *Server) fetchGoogleUserInfo(ctx context.Context, code string, oauthConfig googleOAuthRuntimeConfig) (googleUserInfo, error) {
	values := url.Values{}
	values.Set("code", code)
	values.Set("client_id", oauthConfig.ClientID)
	values.Set("client_secret", oauthConfig.ClientSecret)
	values.Set("redirect_uri", oauthConfig.RedirectURL)
	values.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return googleUserInfo{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return googleUserInfo{}, fmt.Errorf("could not contact Google token service")
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return googleUserInfo{}, fmt.Errorf("Google token exchange failed")
	}
	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil || strings.TrimSpace(tokenResp.AccessToken) == "" {
		return googleUserInfo{}, fmt.Errorf("Google token response was invalid")
	}
	userReq, err := http.NewRequestWithContext(ctx, http.MethodGet, googleUserInfoURL, nil)
	if err != nil {
		return googleUserInfo{}, err
	}
	userReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
	userResp, err := client.Do(userReq)
	if err != nil {
		return googleUserInfo{}, fmt.Errorf("could not load Google account profile")
	}
	defer userResp.Body.Close()
	userBody, _ := io.ReadAll(io.LimitReader(userResp.Body, 1<<20))
	if userResp.StatusCode < 200 || userResp.StatusCode >= 300 {
		return googleUserInfo{}, fmt.Errorf("Google account profile could not be loaded")
	}
	var info googleUserInfo
	if err := json.Unmarshal(userBody, &info); err != nil {
		return googleUserInfo{}, fmt.Errorf("Google account profile was invalid")
	}
	info.Email = strings.ToLower(strings.TrimSpace(info.Email))
	info.Name = strings.TrimSpace(info.Name)
	if info.Email == "" || !strings.Contains(info.Email, "@") || strings.TrimSpace(info.Subject) == "" {
		return googleUserInfo{}, fmt.Errorf("Google account profile is missing email information")
	}
	if info.Name == "" {
		info.Name = strings.Split(info.Email, "@")[0]
	}
	return info, nil
}

func (s *Server) findOrCreateGoogleUser(ctx context.Context, info googleUserInfo, state googleOAuthState) (models.User, bool, error) {
	var existing models.User
	err := s.store.C("users").FindOne(ctx, bson.M{"email": info.Email}).Decode(&existing)
	if err == nil {
		s.ensureUserIdentity(ctx, &existing)
		if strings.TrimSpace(existing.AvatarURL) == "" && strings.TrimSpace(info.Picture) != "" {
			_, _ = s.store.C("users").UpdateByID(ctx, existing.ID, bson.M{"$set": bson.M{"avatar_url": info.Picture}})
			existing.AvatarURL = info.Picture
		}
		return existing, false, nil
	}
	if err != mongo.ErrNoDocuments {
		return models.User{}, false, fmt.Errorf("could not check existing account")
	}

	now := time.Now()
	userID := primitive.NewObjectID()
	teamID := primitive.NewObjectID()
	role := models.RoleTeamAdmin
	staffRole := "manager"
	companyName := strings.TrimSpace(info.Name)
	if companyName == "" {
		companyName = strings.Split(info.Email, "@")[0]
	}
	companyName += "'s Company"

	var invitation *models.TeamInvitation
	if strings.TrimSpace(state.Invite) != "" {
		var loaded models.TeamInvitation
		err := s.store.C("team_invitations").FindOne(ctx, bson.M{"token": strings.TrimSpace(state.Invite), "status": "pending", "expires_at": bson.M{"$gt": now}}).Decode(&loaded)
		if err != nil {
			return models.User{}, false, fmt.Errorf("invitation is invalid or expired")
		}
		if loaded.Email != info.Email {
			return models.User{}, false, fmt.Errorf("invitation email must match Google account email")
		}
		invitation = &loaded
	}

	username, err := s.requestedUsername(ctx, "", info.Name, info.Email)
	if err != nil {
		return models.User{}, false, fmt.Errorf("could not create username")
	}
	randomPassword, err := randomToken()
	if err != nil {
		return models.User{}, false, fmt.Errorf("could not secure Google account")
	}
	hash, err := auth.HashPassword(randomPassword)
	if err != nil {
		return models.User{}, false, fmt.Errorf("could not secure Google account")
	}

	trialSubID, trialPlan, err := s.createTrialSubscription(ctx, teamID, now)
	if err != nil {
		return models.User{}, false, fmt.Errorf("could not create trial subscription")
	}
	team := &models.Team{
		ID:              teamID,
		Name:            companyName,
		CompanyEmail:    info.Email,
		OwnerAdminID:    userID,
		MemberIDs:       []primitive.ObjectID{userID},
		SubscriptionID:  trialSubID,
		SeatLimitCached: trialPlan.SeatLimit,
		CreatedAt:       now,
	}

	user := models.User{
		ID:              userID,
		Name:            info.Name,
		Email:           info.Email,
		Username:        username,
		PasswordHash:    hash,
		Role:            role,
		StaffRole:       staffRole,
		TeamID:          teamID,
		Status:          models.StatusActive,
		AvatarURL:       strings.TrimSpace(info.Picture),
		ThemePreference: "system",
		CreatedAt:       now,
	}
	if _, err := s.store.C("teams").InsertOne(ctx, *team); err != nil {
		return models.User{}, false, fmt.Errorf("could not create team")
	}
	if _, err := s.store.C("users").InsertOne(ctx, user); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return models.User{}, false, fmt.Errorf("email or username already exists")
		}
		return models.User{}, false, fmt.Errorf("could not create Google account")
	}
	if err := s.createStarterWorkspace(ctx, teamID, userID, now); err != nil {
		return models.User{}, false, fmt.Errorf("could not create starter workspace")
	}
	if invitation != nil {
		s.linkPendingInvitationToNewUser(ctx, *invitation, user)
	}
	registrationTeam := *team
	s.enqueueOwnerRegistrationEmail(ctx, user, registrationTeam, "Google", invitation)
	return user, true, nil
}

func mustRandomStateNonce() string {
	token, err := randomToken()
	if err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return token
}

func (s *Server) signGoogleOAuthState(state googleOAuthState) (string, error) {
	return s.signGooglePayload(state)
}

func (s *Server) verifyGoogleOAuthState(raw string) (googleOAuthState, error) {
	var state googleOAuthState
	if err := s.verifyGooglePayload(raw, &state); err != nil {
		return state, err
	}
	if time.Since(time.Unix(state.IssuedAt, 0)) > 10*time.Minute {
		return state, fmt.Errorf("expired state")
	}
	if state.Mode != "register" {
		state.Mode = "login"
	}
	return state, nil
}

func (s *Server) signGoogleTwoFactorChallenge(user models.User, subject string) (string, error) {
	return s.signGooglePayload(googleTwoFactorChallenge{
		UserID:   user.ID.Hex(),
		Subject:  subject,
		IssuedAt: time.Now().Unix(),
		Expires:  time.Now().Add(5 * time.Minute).Unix(),
		Nonce:    mustRandomStateNonce(),
	})
}

func (s *Server) verifyGoogleTwoFactorChallenge(raw string) (googleTwoFactorChallenge, error) {
	var challenge googleTwoFactorChallenge
	if err := s.verifyGooglePayload(raw, &challenge); err != nil {
		return challenge, err
	}
	if challenge.Expires < time.Now().Unix() {
		return challenge, fmt.Errorf("expired challenge")
	}
	return challenge, nil
}

func (s *Server) signGooglePayload(value interface{}) (string, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	_, _ = mac.Write([]byte(encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + signature, nil
}

func (s *Server) verifyGooglePayload(raw string, out interface{}) error {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return fmt.Errorf("invalid payload")
	}
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	_, _ = mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)
	got, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(got, expected) {
		return fmt.Errorf("invalid signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, out)
}

func (s *Server) socialAuthSuccess(c *gin.Context, access string, refresh string, created bool) {
	accessJSON, _ := json.Marshal(access)
	refreshJSON, _ := json.Marshal(refresh)
	message := "Signing you in..."
	if created {
		message = "Creating your workspace..."
	}
	htmlBody := fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Login</title></head><body><p>%s</p><script>localStorage.setItem("bugmega_access", %s);localStorage.setItem("bugmega_refresh", %s);window.location.replace("/dashboard");</script></body></html>`, html.EscapeString(message), accessJSON, refreshJSON)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlBody))
}

func (s *Server) socialAuthTwoFactor(c *gin.Context, challenge string) {
	challengeJSON, _ := json.Marshal(challenge)
	htmlBody := fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify Authenticator</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#101613;color:#edf4ef;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(420px,calc(100vw - 32px));background:#161f1b;border:1px solid #2e3c36;border-radius:8px;padding:24px;box-shadow:0 18px 45px rgba(0,0,0,.3)}label{display:grid;gap:8px;color:#aab8b0;font-weight:700}input{min-height:42px;border-radius:8px;border:1px solid #2e3c36;background:#101613;color:#edf4ef;padding:0 10px;font-size:18px;letter-spacing:4px}button{margin-top:14px;min-height:42px;border:0;border-radius:8px;background:#39c2a9;color:#fff;font-weight:800;padding:0 14px;cursor:pointer}.status{color:#e17570;font-weight:700}</style></head><body><section class="box"><h1>Authenticator code</h1><p>Enter the 6 digit code from your authenticator app to finish Google sign in.</p><form id="form"><label>Code<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus required></label><button>Verify code</button><p class="status" id="status"></p></form></section><script>const challenge=%s;document.getElementById("form").addEventListener("submit",async(e)=>{e.preventDefault();const status=document.getElementById("status");status.textContent="";try{const res=await fetch("/api/auth/google/verify-2fa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({challenge,code:new FormData(e.currentTarget).get("code")})});const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not verify code");localStorage.setItem("bugmega_access",data.access_token);localStorage.setItem("bugmega_refresh",data.refresh_token);window.location.replace("/dashboard")}catch(err){status.textContent=err.message}});</script></body></html>`, challengeJSON)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlBody))
}

func (s *Server) socialAuthError(c *gin.Context, message string) {
	var body bytes.Buffer
	body.WriteString(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Login</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#101613;color:#edf4ef;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(460px,calc(100vw - 32px));background:#161f1b;border:1px solid #2e3c36;border-radius:8px;padding:24px;box-shadow:0 18px 45px rgba(0,0,0,.3)}a{display:inline-flex;align-items:center;min-height:40px;border-radius:8px;background:#39c2a9;color:#fff;text-decoration:none;font-weight:800;padding:0 14px}</style></head><body><section class="box"><h1>Google login needs attention</h1><p>`)
	body.WriteString(html.EscapeString(message))
	body.WriteString(`</p><a href="/login">Back to login</a></section></body></html>`)
	c.Data(http.StatusBadRequest, "text/html; charset=utf-8", body.Bytes())
}
