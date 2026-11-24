package handlers

import (
	"net/http"
	"strings"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type StoreRegisterRequest struct {
	Tenant   string `json:"tenant" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	FullName string `json:"full_name"`
}

type StoreLoginRequest struct {
	Tenant   string `json:"tenant" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

func (s *Server) registerStoreCustomer(c *gin.Context) {
	var req StoreRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.Tenant))
	tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), slug)
	if err != nil || tenant == nil {
		tenant, err = s.store.GetTenantByCustomDomain(c.Request.Context(), slug)
		if err != nil || tenant == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
			return
		}
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	existing, err := s.store.GetStoreCustomerByEmail(c.Request.Context(), tenant.ID, email)
	if err == nil && existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "email is already registered in this store"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to secure password"})
		return
	}

	customer := models.StoreCustomer{
		TenantID:     tenant.ID,
		Email:        email,
		PasswordHash: hash,
		FullName:     strings.TrimSpace(req.FullName),
		Status:       "active",
	}

	if err := s.store.CreateStoreCustomer(c.Request.Context(), &customer); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create account: " + err.Error()})
		return
	}

	token, err := s.tokens.GenerateStoreCustomerToken(customer.ID.Hex(), tenant.ID.Hex(), customer.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue session token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "registered successfully",
		"token":    token,
		"customer": customer,
	})
}

func (s *Server) loginStoreCustomer(c *gin.Context) {
	var req StoreLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.Tenant))
	tenant, err := s.store.GetTenantBySubdomain(c.Request.Context(), slug)
	if err != nil || tenant == nil {
		tenant, err = s.store.GetTenantByCustomDomain(c.Request.Context(), slug)
		if err != nil || tenant == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "store not found"})
			return
		}
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	customer, err := s.store.GetStoreCustomerByEmail(c.Request.Context(), tenant.ID, email)
	if err != nil || customer == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if err := auth.ComparePassword(customer.PasswordHash, req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	token, err := s.tokens.GenerateStoreCustomerToken(customer.ID.Hex(), tenant.ID.Hex(), customer.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue session token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"customer": customer,
	})
}

func (s *Server) getStoreCustomerMe(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing or invalid authorization header"})
		return
	}

	raw := strings.TrimSpace(authHeader[7:])
	claims, err := s.tokens.ParseStoreCustomerToken(raw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
		return
	}

	tenantID, err := primitive.ObjectIDFromHex(claims.TenantID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant id"})
		return
	}

	customer, err := s.store.GetStoreCustomerByEmail(c.Request.Context(), tenantID, claims.Email)
	if err != nil || customer == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "customer profile not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"customer": customer})
}
