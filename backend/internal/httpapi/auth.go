package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"regexp"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"

	"cour/internal/auth"
	"cour/internal/config"
	"cour/internal/httpapi/apigen"
	"cour/internal/store/sqlcgen"
)

const refreshCookieName = "cour_refresh"

// Refresh tokens only ever travel to auth endpoints.
const refreshCookiePath = "/api/v1/auth"

type authHandlers struct {
	svc     *auth.Service
	discord *auth.Discord // nil = OAuth disabled
	rdb     *redis.Client
	limiter *redis_rate.Limiter
	cfg     config.Config
	log     *slog.Logger
}

// ── Cookie + CSRF plumbing ─────────────────────────────────────────────────

func (h authHandlers) setRefreshCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     refreshCookiePath,
		Expires:  expires,
		HttpOnly: true,
		Secure:   h.cfg.Env == "prod",
		SameSite: http.SameSiteLaxMode,
	})
}

func (h authHandlers) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cfg.Env == "prod",
		SameSite: http.SameSiteLaxMode,
	})
}

// requireHeaderGuard enforces the custom-header CSRF check on
// cookie-authenticated endpoints (SameSite=Lax is the first line; a custom
// header can't be attached cross-site without a CORS preflight we never allow).
func requireHeaderGuard(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("X-Requested-With") == "" {
		writeError(w, http.StatusForbidden, CodeForbidden, "missing X-Requested-With header")
		return false
	}
	return true
}

// strictLimit guards credential endpoints: 5 attempts/min per IP.
func (h authHandlers) strictLimit(w http.ResponseWriter, r *http.Request, name string) bool {
	res, err := h.limiter.Allow(r.Context(), "rl:auth:"+name+":"+byIP(r), redis_rate.PerMinute(5))
	if err != nil {
		return true // fail open; Redis outage shouldn't lock users out
	}
	if res.Allowed == 0 {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, CodeRateLimited, "too many attempts, try again shortly")
		return false
	}
	return true
}

// ── Handlers (apigen.ServerInterface auth methods) ─────────────────────────

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

func validCredentials(email, password string) map[string]string {
	problems := map[string]string{}
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > 254 {
		problems["email"] = "must be a valid email address"
	}
	if len(password) < 8 || len(password) > 128 {
		problems["password"] = "must be 8-128 characters"
	}
	return problems
}

func (h authHandlers) Register(w http.ResponseWriter, r *http.Request) {
	if !h.strictLimit(w, r, "register") {
		return
	}
	req, ok := decodeJSON[apigen.RegisterRequest](w, r)
	if !ok {
		return
	}
	problems := validCredentials(string(req.Email), req.Password)
	if !usernameRe.MatchString(req.Username) {
		problems["username"] = "must be 3-20 characters: letters, digits, underscore"
	}
	if len(problems) > 0 {
		writeValidation(w, problems)
		return
	}

	session, err := h.svc.Register(r.Context(), string(req.Email), req.Username, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrEmailTaken):
			writeError(w, http.StatusConflict, CodeConflict, "that email is already registered")
		case errors.Is(err, auth.ErrUsernameTaken):
			writeError(w, http.StatusConflict, CodeConflict, "that username is taken")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	h.setRefreshCookie(w, session.RefreshToken, session.RefreshExpires)
	writeJSON(w, http.StatusCreated, h.sessionResponse(session))
}

func (h authHandlers) Login(w http.ResponseWriter, r *http.Request) {
	if !h.strictLimit(w, r, "login") {
		return
	}
	req, ok := decodeJSON[apigen.LoginRequest](w, r)
	if !ok {
		return
	}
	session, err := h.svc.Login(r.Context(), string(req.Email), req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, "wrong email or password")
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	h.setRefreshCookie(w, session.RefreshToken, session.RefreshExpires)
	writeJSON(w, http.StatusOK, h.sessionResponse(session))
}

func (h authHandlers) RefreshSession(w http.ResponseWriter, r *http.Request) {
	if !requireHeaderGuard(w, r) {
		return
	}
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized, "no session")
		return
	}
	session, err := h.svc.Refresh(r.Context(), cookie.Value)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidRefresh) {
			h.clearRefreshCookie(w)
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, "session expired")
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	h.setRefreshCookie(w, session.RefreshToken, session.RefreshExpires)
	writeJSON(w, http.StatusOK, h.sessionResponse(session))
}

func (h authHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	if !requireHeaderGuard(w, r) {
		return
	}
	if cookie, err := r.Cookie(refreshCookieName); err == nil && cookie.Value != "" {
		if err := h.svc.Logout(r.Context(), cookie.Value); err != nil {
			writeInternal(w, h.log, err)
			return
		}
	}
	h.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h authHandlers) GetMe(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	user, err := h.svc.User(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toUserPrivate(user))
}

func (h authHandlers) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeJSON[apigen.TokenRequest](w, r)
	if !ok {
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), req.Token); err != nil {
		if errors.Is(err, auth.ErrInvalidEmailToken) {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "invalid or expired token")
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h authHandlers) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if !h.strictLimit(w, r, "pwreset") {
		return
	}
	req, ok := decodeJSON[apigen.PasswordResetRequest](w, r)
	if !ok {
		return
	}
	if err := h.svc.RequestPasswordReset(r.Context(), string(req.Email)); err != nil {
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h authHandlers) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeJSON[apigen.PasswordResetConfirm](w, r)
	if !ok {
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 128 {
		writeValidation(w, map[string]string{"password": "must be 8-128 characters"})
		return
	}
	if err := h.svc.ResetPassword(r.Context(), req.Token, req.Password); err != nil {
		if errors.Is(err, auth.ErrInvalidEmailToken) {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "invalid or expired token")
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h authHandlers) ResendVerification(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if !h.strictLimit(w, r, "resend-verify") {
		return
	}
	user, err := h.svc.User(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	if err := h.svc.SendVerification(r.Context(), user); err != nil {
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ── Discord OAuth ──────────────────────────────────────────────────────────

const oauthStateTTL = 10 * time.Minute

func (h authHandlers) DiscordStart(w http.ResponseWriter, r *http.Request) {
	if h.discord == nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Discord login is not configured")
		return
	}
	state, _, err := auth.NewOpaqueToken()
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	if err := h.rdb.Set(r.Context(), "oauth:state:"+state, "1", oauthStateTTL).Err(); err != nil {
		writeInternal(w, h.log, err)
		return
	}
	http.Redirect(w, r, h.discord.AuthURL(state), http.StatusFound)
}

func (h authHandlers) DiscordCallback(w http.ResponseWriter, r *http.Request, params apigen.DiscordCallbackParams) {
	if h.discord == nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Discord login is not configured")
		return
	}
	if params.Code == nil || params.State == nil {
		http.Redirect(w, r, h.cfg.WebOrigin+"/login?error=discord_cancelled", http.StatusFound)
		return
	}
	deleted, err := h.rdb.Del(r.Context(), "oauth:state:"+*params.State).Result()
	if err != nil || deleted == 0 {
		http.Redirect(w, r, h.cfg.WebOrigin+"/login?error=discord_state", http.StatusFound)
		return
	}

	session, err := h.svc.DiscordLogin(r.Context(), h.discord, *params.Code)
	if err != nil {
		if errors.Is(err, auth.ErrDiscordNoEmail) {
			http.Redirect(w, r, h.cfg.WebOrigin+"/login?error=discord_no_email", http.StatusFound)
			return
		}
		h.log.Error("discord login", "err", err)
		http.Redirect(w, r, h.cfg.WebOrigin+"/login?error=discord_failed", http.StatusFound)
		return
	}
	h.setRefreshCookie(w, session.RefreshToken, session.RefreshExpires)
	http.Redirect(w, r, h.cfg.WebOrigin+"/", http.StatusFound)
}

// ── DTOs ───────────────────────────────────────────────────────────────────

func (h authHandlers) sessionResponse(s auth.Session) apigen.SessionResponse {
	return apigen.SessionResponse{
		AccessToken: s.AccessToken,
		TokenType:   apigen.Bearer,
		ExpiresIn:   int(h.cfg.AccessTokenTTL.Seconds()),
		User:        toUserPrivate(s.User),
	}
}

func toUserPrivate(u sqlcgen.User) apigen.UserPrivate {
	return apigen.UserPrivate{
		Id:             u.ID,
		Email:          u.Email,
		Username:       u.Username,
		AvatarUrl:      u.AvatarUrl,
		Bio:            u.Bio,
		FavoriteGenres: u.FavoriteGenres,
		Role:           apigen.Role(u.Role),
		EmailVerified:  u.EmailVerifiedAt != nil,
		CreatedAt:      u.CreatedAt,
	}
}
