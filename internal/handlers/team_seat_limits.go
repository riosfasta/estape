package handlers

import (
	"context"
	"net/http"
	"time"

	"bugmark/internal/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

func (s *Server) liveTeamSeatLimit(ctx context.Context, team models.Team) int {
	_, plan, _ := s.teamMembership(ctx, team.ID)
	if plan.SeatLimit > 0 {
		if team.SeatLimitCached != plan.SeatLimit {
			_, _ = s.store.C("teams").UpdateByID(ctx, team.ID, bson.M{"$set": bson.M{"seat_limit_cached": plan.SeatLimit}})
		}
		return plan.SeatLimit
	}
	return team.SeatLimitCached
}

func (s *Server) teamSeatAvailability(ctx context.Context, team models.Team, includePending bool) (int, int, error) {
	limit := s.liveTeamSeatLimit(ctx, team)
	used := int(teamSeatCount(team))
	if includePending {
		pending, err := s.store.C("team_invitations").CountDocuments(ctx, bson.M{
			"team_id":    team.ID,
			"status":     "pending",
			"expires_at": bson.M{"$gt": time.Now()},
		})
		if err != nil {
			return used, limit, err
		}
		used += int(pending)
	}
	return used, limit, nil
}

func (s *Server) requireAvailableTeamSeat(c *gin.Context, team models.Team, includePending bool) bool {
	used, limit, err := s.teamSeatAvailability(c.Request.Context(), team, includePending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not verify the team seat limit"})
		return false
	}
	if limit > 0 && used >= limit {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":      "seat limit reached; remove a member or upgrade your subscription",
			"code":       "seat_limit_reached",
			"seat_limit": limit,
			"seats_used": used,
		})
		return false
	}
	return true
}
