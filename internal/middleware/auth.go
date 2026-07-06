package middleware

import (
	"net/http"
	"strings"

	"bugmark/internal/auth"
	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

const UserContextKey = "auth_user"

type UserContext struct {
	ID     primitive.ObjectID
	Role   models.Role
	TeamID primitive.ObjectID
}

func AuthRequired(tokens *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		if header == "" {
			if cookie, err := c.Cookie("access_token"); err == nil {
				header = "Bearer " + cookie
			}
		}
		if header == "" && strings.TrimSpace(c.Query("token")) != "" {
			header = "Bearer " + strings.TrimSpace(c.Query("token"))
		}
		if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		raw := strings.TrimSpace(header[7:])
		claims, err := tokens.ParseAccessToken(raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		userID, err := primitive.ObjectIDFromHex(claims.Subject)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token subject"})
			return
		}
		var teamID primitive.ObjectID
		if claims.TeamID != "" {
			teamID, _ = primitive.ObjectIDFromHex(claims.TeamID)
		}
		c.Set(UserContextKey, UserContext{ID: userID, Role: models.Role(claims.Role), TeamID: teamID})
		c.Next()
	}
}

func RequireRoles(roles ...models.Role) gin.HandlerFunc {
	allowed := map[models.Role]bool{}
	for _, role := range roles {
		allowed[role] = true
	}
	return func(c *gin.Context) {
		user, ok := CurrentUser(c)
		if !ok || !allowed[user.Role] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
			return
		}
		c.Next()
	}
}

func CurrentUser(c *gin.Context) (UserContext, bool) {
	value, ok := c.Get(UserContextKey)
	if !ok {
		return UserContext{}, false
	}
	user, ok := value.(UserContext)
	return user, ok
}
