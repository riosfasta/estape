package handlers

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	registrationBurstWindow = 15 * time.Minute
	registrationDailyWindow = 24 * time.Hour
	registrationBurstLimit  = 5
	registrationDailyLimit  = 30
)

type registrationRateLimiter struct {
	mu        sync.Mutex
	attempts  map[string][]time.Time
	lastPrune time.Time
}

func newRegistrationRateLimiter() *registrationRateLimiter {
	return &registrationRateLimiter{attempts: map[string][]time.Time{}}
}

func (l *registrationRateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "unknown"
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if l.lastPrune.IsZero() || now.Sub(l.lastPrune) > registrationBurstWindow {
		l.prune(now)
	}

	dailyCutoff := now.Add(-registrationDailyWindow)
	recent := l.attempts[key]
	write := recent[:0]
	for _, at := range recent {
		if at.After(dailyCutoff) {
			write = append(write, at)
		}
	}
	recent = write
	l.attempts[key] = recent

	burstCutoff := now.Add(-registrationBurstWindow)
	burst := 0
	var oldestBurst time.Time
	for _, at := range recent {
		if at.After(burstCutoff) {
			if oldestBurst.IsZero() || at.Before(oldestBurst) {
				oldestBurst = at
			}
			burst++
		}
	}

	if burst >= registrationBurstLimit {
		return false, retryAfter(oldestBurst.Add(registrationBurstWindow).Sub(now))
	}
	if len(recent) >= registrationDailyLimit {
		return false, retryAfter(recent[0].Add(registrationDailyWindow).Sub(now))
	}

	l.attempts[key] = append(recent, now)
	return true, 0
}

func (l *registrationRateLimiter) prune(now time.Time) {
	cutoff := now.Add(-registrationDailyWindow)
	for key, attempts := range l.attempts {
		write := attempts[:0]
		for _, at := range attempts {
			if at.After(cutoff) {
				write = append(write, at)
			}
		}
		if len(write) == 0 {
			delete(l.attempts, key)
			continue
		}
		l.attempts[key] = write
	}
	l.lastPrune = now
}

func retryAfter(value time.Duration) time.Duration {
	if value < time.Second {
		return time.Second
	}
	return value
}

func (s *Server) allowRegistrationAttempt(c *gin.Context) bool {
	if s.signupLimits == nil {
		return true
	}
	ok, wait := s.signupLimits.allow(registrationClientIP(c), time.Now())
	if ok {
		return true
	}
	seconds := int((wait + time.Second - 1) / time.Second)
	c.Header("Retry-After", strconv.Itoa(seconds))
	c.JSON(http.StatusTooManyRequests, gin.H{
		"error":               "too many registration attempts from this IP. Please try again later.",
		"retry_after_seconds": seconds,
	})
	return false
}

func registrationClientIP(c *gin.Context) string {
	if ip := strings.TrimSpace(c.ClientIP()); ip != "" {
		return normalizeIPKey(ip)
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return normalizeIPKey(c.Request.RemoteAddr)
	}
	return normalizeIPKey(host)
}

func normalizeIPKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if ip := net.ParseIP(value); ip != nil {
		return ip.String()
	}
	return value
}
