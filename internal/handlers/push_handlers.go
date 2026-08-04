package handlers

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"bugmark/internal/config"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type PushService struct {
	projectID string
	account   fcmServiceAccount
	client    *http.Client
	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

type fcmServiceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

func NewPushService(cfg config.Config) *PushService {
	raw := strings.TrimSpace(cfg.FCMServiceAccount)
	if raw == "" && strings.TrimSpace(cfg.FCMServiceAccountFile) != "" {
		if data, err := os.ReadFile(cfg.FCMServiceAccountFile); err == nil {
			raw = string(data)
		}
	}
	if raw == "" {
		return nil
	}
	var account fcmServiceAccount
	if err := json.Unmarshal([]byte(raw), &account); err != nil {
		return nil
	}
	projectID := firstNonEmpty(cfg.FCMProjectID, account.ProjectID)
	if projectID == "" || account.ClientEmail == "" || account.PrivateKey == "" {
		return nil
	}
	if account.TokenURI == "" {
		account.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &PushService{projectID: projectID, account: account, client: &http.Client{Timeout: 12 * time.Second}}
}

func (p *PushService) enabled() bool {
	return p != nil && p.projectID != "" && p.account.ClientEmail != "" && p.account.PrivateKey != ""
}

func (p *PushService) Send(ctx context.Context, token string, title string, body string, data map[string]string) error {
	if !p.enabled() {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" || strings.TrimSpace(body) == "" {
		return nil
	}
	accessToken, err := p.accessToken(ctx)
	if err != nil {
		return err
	}
	message := gin.H{
		"message": gin.H{
			"token": token,
			"notification": gin.H{
				"title": title,
				"body":  body,
			},
			"data": data,
			"android": gin.H{
				"priority": "high",
				"notification": gin.H{
					"channel_id": "bugmega_updates",
					"sound":      "default",
				},
			},
			"apns": gin.H{
				"headers": gin.H{"apns-priority": "10"},
				"payload": gin.H{
					"aps": gin.H{"sound": "default"},
				},
			},
		},
	}
	payload, _ := json.Marshal(message)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://fcm.googleapis.com/v1/projects/"+url.PathEscape(p.projectID)+"/messages:send", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	bodyBytes, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	return &fcmSendError{status: res.StatusCode, body: string(bodyBytes)}
}

func (p *PushService) accessToken(ctx context.Context) (string, error) {
	p.mu.Lock()
	if p.token != "" && time.Now().Before(p.expiresAt.Add(-1*time.Minute)) {
		token := p.token
		p.mu.Unlock()
		return token, nil
	}
	p.mu.Unlock()

	assertion, err := p.signedAssertion()
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.account.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var response struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 || response.AccessToken == "" {
		return "", errors.New(firstNonEmpty(response.Description, response.Error, "could not get FCM access token"))
	}
	if response.ExpiresIn <= 0 {
		response.ExpiresIn = 3600
	}
	p.mu.Lock()
	p.token = response.AccessToken
	p.expiresAt = time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)
	p.mu.Unlock()
	return response.AccessToken, nil
}

func (p *PushService) signedAssertion() (string, error) {
	privateKey, err := parseServiceAccountPrivateKey(p.account.PrivateKey)
	if err != nil {
		return "", err
	}
	now := time.Now()
	header := base64URLJSON(gin.H{"alg": "RS256", "typ": "JWT"})
	claims := base64URLJSON(gin.H{
		"iss":   p.account.ClientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   p.account.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	unsigned := header + "." + claims
	sum := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func base64URLJSON(value any) string {
	out, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(out)
}

func parseServiceAccountPrivateKey(value string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(value))
	if block == nil {
		return nil, errors.New("invalid FCM private key")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("FCM private key is not RSA")
	}
	return key, nil
}

type fcmSendError struct {
	status int
	body   string
}

func (e *fcmSendError) Error() string {
	return strings.TrimSpace(e.body)
}

func (e *fcmSendError) invalidToken() bool {
	body := strings.ToUpper(e.body)
	return e.status == http.StatusNotFound || strings.Contains(body, "UNREGISTERED") || strings.Contains(body, "INVALID_ARGUMENT")
}

func (s *Server) registerPushDevice(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Token      string `json:"token"`
		Platform   string `json:"platform"`
		AppVersion string `json:"app_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device body"})
		return
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device token is required"})
		return
	}
	platform := strings.ToLower(strings.TrimSpace(req.Platform))
	if platform != "android" && platform != "ios" {
		platform = "unknown"
	}
	now := time.Now()
	set := bson.M{
		"user_id":      userCtx.ID,
		"token":        token,
		"platform":     platform,
		"enabled":      true,
		"app_version":  strings.TrimSpace(req.AppVersion),
		"updated_at":   now,
		"last_seen_at": now,
	}
	update := bson.M{"$set": set, "$setOnInsert": bson.M{"_id": primitive.NewObjectID(), "created_at": now}}
	opts := options.Update().SetUpsert(true)
	if _, err := s.store.C("push_devices").UpdateOne(c.Request.Context(), bson.M{"token": token}, update, opts); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not register device"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"registered": true})
}

func (s *Server) unregisterPushDevice(c *gin.Context) {
	userCtx, _ := currentUser(c)
	var req struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Token) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device token is required"})
		return
	}
	_, _ = s.store.C("push_devices").UpdateOne(c.Request.Context(), bson.M{"user_id": userCtx.ID, "token": strings.TrimSpace(req.Token)}, bson.M{"$set": bson.M{"enabled": false, "updated_at": time.Now()}})
	c.JSON(http.StatusOK, gin.H{"unregistered": true})
}

func (s *Server) insertNotification(ctx context.Context, note models.Notification) bool {
	if note.ID.IsZero() {
		note.ID = primitive.NewObjectID()
	}
	if note.CreatedAt.IsZero() {
		note.CreatedAt = time.Now()
	}
	if strings.TrimSpace(note.Content) == "" || note.UserID.IsZero() {
		return false
	}
	if _, err := s.store.C("notifications").InsertOne(ctx, note); err != nil {
		return false
	}
	s.broadcastLiveToUsers([]primitive.ObjectID{note.UserID}, "notification_changed", gin.H{"notification_type": note.Type, "notification_id": note.ID.Hex(), "related_id": note.RelatedID.Hex()})
	s.dispatchPushNotification(note)
	return true
}

func (s *Server) dispatchPushNotification(note models.Notification) {
	if s.push == nil || !s.push.enabled() {
		return
	}
	go func(note models.Notification) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		cursor, err := s.store.C("push_devices").Find(ctx, bson.M{"user_id": note.UserID, "enabled": true})
		if err != nil {
			return
		}
		defer cursor.Close(ctx)
		title := pushTitle(s.cfg.AppName, note.Type)
		body := trimForNotification(note.Content)
		data := map[string]string{
			"notification_id": note.ID.Hex(),
			"type":            note.Type,
			"related_id":      note.RelatedID.Hex(),
			"click_action":    "FLUTTER_NOTIFICATION_CLICK",
		}
		for cursor.Next(ctx) {
			var device models.PushDevice
			if cursor.Decode(&device) != nil || strings.TrimSpace(device.Token) == "" {
				continue
			}
			if err := s.push.Send(ctx, device.Token, title, body, data); err != nil {
				if sendErr, ok := err.(*fcmSendError); ok && sendErr.invalidToken() {
					_, _ = s.store.C("push_devices").UpdateOne(ctx, bson.M{"_id": device.ID}, bson.M{"$set": bson.M{"enabled": false, "updated_at": time.Now()}})
				}
			}
		}
	}(note)
}

func pushTitle(appName string, notificationType string) string {
	appName = firstNonEmpty(strings.TrimSpace(appName), "bugmega")
	switch {
	case strings.Contains(notificationType, "subscription"):
		return appName + " purchase"
	case strings.Contains(notificationType, "support"):
		return appName + " help chat"
	case strings.Contains(notificationType, "chat"):
		return appName + " chat"
	case strings.Contains(notificationType, "task"):
		return appName + " task update"
	case strings.Contains(notificationType, "mention"):
		return appName + " mention"
	default:
		return appName + " notification"
	}
}

func disableUserPushDevices(ctx context.Context, db *mongo.Collection, userID primitive.ObjectID) {
	if userID.IsZero() {
		return
	}
	_, _ = db.UpdateMany(ctx, bson.M{"user_id": userID}, bson.M{"$set": bson.M{"enabled": false, "updated_at": time.Now()}})
}
