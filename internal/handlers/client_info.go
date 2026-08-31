package handlers

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func realClientIP(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	if ip := strings.TrimSpace(c.ClientIP()); ip != "" {
		return ip
	}
	if c.Request.RemoteAddr != "" {
		host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err == nil && host != "" {
			return host
		}
		return strings.TrimSpace(c.Request.RemoteAddr)
	}
	return ""
}

type ipAPIResponse struct {
	Status      string `json:"status"`
	Country     string `json:"country"`
	CountryCode string `json:"countryCode"`
	City        string `json:"city"`
	Timezone    string `json:"timezone"`
	ISP         string `json:"isp"`
	Org         string `json:"org"`
	AS          string `json:"as"`
	Query       string `json:"query"`
}

func (s *Server) enrichClientGeo(ctx context.Context, userID primitive.ObjectID, ip string) {
	if strings.TrimSpace(ip) == "" || userID.IsZero() {
		return
	}
	if ip == "127.0.0.1" || ip == "::1" || strings.HasPrefix(ip, "192.168.") ||
		strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "172.16.") ||
		strings.HasPrefix(ip, "172.17.") || strings.HasPrefix(ip, "172.18.") ||
		strings.HasPrefix(ip, "172.19.") || strings.HasPrefix(ip, "172.2") ||
		strings.HasPrefix(ip, "172.30.") || strings.HasPrefix(ip, "172.31.") {
		_, _ = s.store.C("users").UpdateByID(ctx, userID, bson.M{"$set": bson.M{
			"registration_country_code": "XX",
			"registration_country":      "Local network",
			"registration_network_name": "Private / local address",
		}})
		return
	}
	endpoint := "http://ip-api.com/json/" + strings.TrimSpace(ip) + "?fields=status,country,countryCode,city,timezone,isp,org,as,query"
	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "bugmark/1.0 (platform admin tooling)")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var data ipAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return
	}
	if data.Status != "success" {
		return
	}
	set := bson.M{}
	if code := strings.TrimSpace(data.CountryCode); code != "" {
		set["registration_country_code"] = code
	}
	if name := strings.TrimSpace(data.Country); name != "" {
		set["registration_country"] = name
	}
	if city := strings.TrimSpace(data.City); city != "" {
		set["registration_city"] = city
	}
	if tz := strings.TrimSpace(data.Timezone); tz != "" {
		set["registration_timezone"] = tz
	}
	netName := strings.TrimSpace(data.AS)
	if netName == "" {
		netName = strings.TrimSpace(data.ISP)
	}
	if netName == "" {
		netName = strings.TrimSpace(data.Org)
	}
	if netName != "" {
		set["registration_network_name"] = netName
	}
	if len(set) == 0 {
		return
	}
	_, _ = s.store.C("users").UpdateByID(ctx, userID, bson.M{"$set": set})
}

func (s *Server) prepareRegistrationMeta(c *gin.Context, user *models.User) string {
	if user == nil {
		return ""
	}
	ip := realClientIP(c)
	user.RegistrationIP = ip
	return ip
}

func (s *Server) enrichRegistrationMeta(userID primitive.ObjectID, ip string) {
	if userID.IsZero() || strings.TrimSpace(ip) == "" {
		return
	}
	go func(userID primitive.ObjectID, ip string) {
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		defer cancel()
		s.enrichClientGeo(ctx, userID, ip)
	}(userID, ip)
}
