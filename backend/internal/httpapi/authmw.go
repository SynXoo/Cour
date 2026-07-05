package httpapi

import (
	"context"
	"net/http"
	"strings"

	"cour/internal/auth"
)

type ctxKey int

const claimsKey ctxKey = iota

// Identity is the authenticated caller, extracted from a bearer token.
type Identity struct {
	UserID   int64
	Username string
	Role     string
}

func (id Identity) IsMod() bool { return id.Role == "mod" || id.Role == "admin" }

// optionalAuth attaches identity when a valid token is present, but lets
// anonymous requests through.
func optionalAuth(issuer *auth.TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if id, ok := bearerIdentity(issuer, r); ok {
				r = r.WithContext(context.WithValue(r.Context(), claimsKey, id))
			}
			next.ServeHTTP(w, r)
		})
	}
}

func bearerIdentity(issuer *auth.TokenIssuer, r *http.Request) (Identity, bool) {
	header := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || token == "" {
		return Identity{}, false
	}
	claims, err := issuer.ParseAccess(token)
	if err != nil {
		return Identity{}, false
	}
	userID, err := claims.UserID()
	if err != nil {
		return Identity{}, false
	}
	return Identity{UserID: userID, Username: claims.Username, Role: claims.Role}, true
}

// identity returns the authenticated caller, if any.
func identity(r *http.Request) (Identity, bool) {
	id, ok := r.Context().Value(claimsKey).(Identity)
	return id, ok
}

// mustIdentity is the in-handler auth gate: it writes the 401 envelope and
// returns ok=false when the request is anonymous.
func mustIdentity(w http.ResponseWriter, r *http.Request) (Identity, bool) {
	id, ok := identity(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized, "authentication required")
	}
	return id, ok
}
