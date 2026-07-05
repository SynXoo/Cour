package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"strconv"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
)

// rateLimit enforces a GCRA (leaky-bucket) limit in Redis, keyed per client.
// Fails open: if Redis is unreachable the request proceeds — availability
// over strictness for a read-mostly API.
func rateLimit(rdb *redis.Client, name string, limit redis_rate.Limit, key func(r *http.Request) string) func(http.Handler) http.Handler {
	limiter := redis_rate.NewLimiter(rdb)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			res, err := limiter.Allow(r.Context(), fmt.Sprintf("rl:%s:%s", name, key(r)), limit)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			if res.Allowed == 0 {
				seconds := int(res.RetryAfter.Seconds() + 0.5)
				if seconds < 1 {
					seconds = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(seconds))
				writeError(w, http.StatusTooManyRequests, CodeRateLimited, "too many requests, slow down")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// byIP keys limits on the client IP. Direct connection address only — proxy
// headers are spoofable and deliberately ignored (see server.go note).
func byIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// byUser keys limits on the authenticated user, falling back to IP.
func byUser(r *http.Request) string {
	if id, ok := identity(r); ok {
		return "u" + strconv.FormatInt(id.UserID, 10)
	}
	return byIP(r)
}
