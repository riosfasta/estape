package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

type PublicFormSubmitRequest struct {
	Tenant   string            `json:"tenant" binding:"required"`
	FormName string            `json:"form_name"`
	Fields   map[string]string `json:"fields" binding:"required"`
}

func (s *Server) submitPublicTenantForm(c *gin.Context) {
	var req PublicFormSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload: " + err.Error()})
		return
	}

	tenantSlug := strings.ToLower(strings.TrimSpace(req.Tenant))
	tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), tenantSlug)
	if err != nil || tenant == nil {
		// Try custom domain
		tenant, err = s.store.GetTenantByCustomDomain(c.Request.Context(), tenantSlug)
		if err != nil || tenant == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
			return
		}
	}

	formName := strings.TrimSpace(req.FormName)
	if formName == "" {
		formName = "Contact Form"
	}

	// Extract visitor email and name from fields map
	var visitorEmail, visitorName string
	for k, v := range req.Fields {
		lowerKey := strings.ToLower(strings.TrimSpace(k))
		val := strings.TrimSpace(v)
		if visitorEmail == "" && (lowerKey == "email" || lowerKey == "e-mail" || strings.Contains(lowerKey, "email")) {
			visitorEmail = val
		}
		if visitorName == "" && (lowerKey == "name" || lowerKey == "fullname" || lowerKey == "full_name" || lowerKey == "first_name") {
			visitorName = val
		}
	}

	submission := models.TenantFormSubmission{
		TenantID:          tenant.ID,
		TenantSubdomain:   tenant.Subdomain,
		FormName:          formName,
		Fields:            req.Fields,
		VisitorEmail:      visitorEmail,
		VisitorName:       visitorName,
		AutoResponderSent: tenant.AutoResponder.Enabled && visitorEmail != "",
		CreatedAt:         time.Now(),
	}

	if err := s.store.CreateTenantFormSubmission(c.Request.Context(), &submission); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record submission: " + err.Error()})
		return
	}

	// Dispatch emails asynchronously in background
	go func(t models.Tenant, vEmail, vName, fName string, fields map[string]string) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		// 1. Send Auto-Responder / Welcome email to visitor
		if t.AutoResponder.Enabled && vEmail != "" && s.mailer != nil {
			_ = s.mailer.SendTenantAutoResponder(ctx, &t, vEmail, vName, fields)
		}

		// 2. Send Lead Notification to Store Owner
		if s.mailer != nil {
			var owner models.User
			if err := s.store.C("users").FindOne(ctx, bson.M{"_id": t.OwnerUserID}).Decode(&owner); err == nil && owner.Email != "" {
				_ = s.mailer.SendTenantOwnerNotification(ctx, &t, owner.Email, fName, fields)
			}
		}
	}(*tenant, visitorEmail, visitorName, formName, req.Fields)

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Thank you! Your message has been received.",
	})
}
