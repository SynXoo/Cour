package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/mail"
	"cour/internal/store/sqlcgen"
)

var (
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	ErrEmailTaken         = errors.New("auth: email already registered")
	ErrUsernameTaken      = errors.New("auth: username already taken")
	ErrInvalidRefresh     = errors.New("auth: invalid refresh token")
	ErrInvalidEmailToken  = errors.New("auth: invalid or expired token")
)

type Service struct {
	q          *sqlcgen.Queries
	pool       *pgxpool.Pool
	issuer     *TokenIssuer
	mailer     mail.Mailer
	refreshTTL time.Duration
	webOrigin  string
	log        *slog.Logger
}

func NewService(pool *pgxpool.Pool, issuer *TokenIssuer, mailer mail.Mailer, refreshTTL time.Duration, webOrigin string, log *slog.Logger) *Service {
	return &Service{
		q:          sqlcgen.New(pool),
		pool:       pool,
		issuer:     issuer,
		mailer:     mailer,
		refreshTTL: refreshTTL,
		webOrigin:  webOrigin,
		log:        log,
	}
}

// Session is what a successful register/login/refresh produces. The handler
// returns the access token in the body and sets the refresh token as an
// httpOnly cookie.
type Session struct {
	User           sqlcgen.User
	AccessToken    string
	RefreshToken   string
	RefreshExpires time.Time
}

func (s *Service) Register(ctx context.Context, email, username, password string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	username = strings.TrimSpace(username)

	hash, err := HashPassword(password)
	if err != nil {
		return Session{}, err
	}

	user, err := s.q.CreateUser(ctx, sqlcgen.CreateUserParams{
		Email:        email,
		Username:     username,
		PasswordHash: &hash,
	})
	if err != nil {
		if constraint, ok := uniqueViolation(err); ok {
			if strings.Contains(constraint, "email") {
				return Session{}, ErrEmailTaken
			}
			return Session{}, ErrUsernameTaken
		}
		return Session{}, fmt.Errorf("create user: %w", err)
	}

	if err := s.SendVerification(ctx, user); err != nil {
		// Non-fatal: the account exists; verification can be re-requested.
		s.log.Warn("send verification failed", "user", user.ID, "err", err)
	}
	return s.issueSession(ctx, user)
}

func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	user, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Burn comparable time so absent accounts aren't distinguishable.
			_ = VerifyPassword(password, dummyHash)
			return Session{}, ErrInvalidCredentials
		}
		return Session{}, fmt.Errorf("get user: %w", err)
	}
	if user.PasswordHash == nil {
		_ = VerifyPassword(password, dummyHash)
		return Session{}, ErrInvalidCredentials
	}
	if err := VerifyPassword(password, *user.PasswordHash); err != nil {
		if errors.Is(err, ErrWrongPassword) {
			return Session{}, ErrInvalidCredentials
		}
		return Session{}, err
	}
	return s.issueSession(ctx, user)
}

// dummyHash is a valid argon2id hash of an unguessable value, used to
// equalize timing on failed lookups.
var dummyHash = func() string {
	h, err := HashPassword(uuid.NewString())
	if err != nil {
		panic(err)
	}
	return h
}()

// issueSession starts a new refresh-token family (one per login/device).
func (s *Service) issueSession(ctx context.Context, user sqlcgen.User) (Session, error) {
	return s.mintSession(ctx, user, uuid.New())
}

func (s *Service) mintSession(ctx context.Context, user sqlcgen.User, family uuid.UUID) (Session, error) {
	access, err := s.issuer.IssueAccess(user.ID, user.Username, string(user.Role), time.Now())
	if err != nil {
		return Session{}, fmt.Errorf("issue access: %w", err)
	}
	refresh, hash, err := NewOpaqueToken()
	if err != nil {
		return Session{}, err
	}
	expires := time.Now().Add(s.refreshTTL)
	if err := s.q.InsertRefreshToken(ctx, sqlcgen.InsertRefreshTokenParams{
		UserID:    user.ID,
		FamilyID:  family,
		TokenHash: hash,
		ExpiresAt: expires,
	}); err != nil {
		return Session{}, fmt.Errorf("insert refresh: %w", err)
	}
	return Session{User: user, AccessToken: access, RefreshToken: refresh, RefreshExpires: expires}, nil
}

// Refresh rotates a refresh token: the presented token is marked used and a
// new one is issued in the same family. Presenting an already-used token is
// treated as theft and revokes the whole family.
func (s *Service) Refresh(ctx context.Context, rawToken string) (Session, error) {
	row, err := s.q.GetRefreshToken(ctx, HashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrInvalidRefresh
		}
		return Session{}, fmt.Errorf("get refresh: %w", err)
	}

	switch {
	case row.RevokedAt != nil:
		return Session{}, ErrInvalidRefresh
	case row.UsedAt != nil:
		// Token replay: someone (possibly the attacker, possibly the victim)
		// is holding a stale token. Kill the whole family.
		s.log.Warn("refresh token reuse detected — revoking family",
			"user", row.UserID, "family", row.FamilyID)
		if err := s.q.RevokeRefreshFamily(ctx, row.FamilyID); err != nil {
			return Session{}, fmt.Errorf("revoke family: %w", err)
		}
		return Session{}, ErrInvalidRefresh
	case time.Now().After(row.ExpiresAt):
		return Session{}, ErrInvalidRefresh
	}

	user, err := s.q.GetUser(ctx, row.UserID)
	if err != nil {
		return Session{}, fmt.Errorf("get user: %w", err)
	}

	// Rotate atomically: mark used + mint successor in one transaction.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := s.q.WithTx(tx)
	if err := qtx.MarkRefreshTokenUsed(ctx, row.ID); err != nil {
		return Session{}, fmt.Errorf("mark used: %w", err)
	}

	access, err := s.issuer.IssueAccess(user.ID, user.Username, string(user.Role), time.Now())
	if err != nil {
		return Session{}, fmt.Errorf("issue access: %w", err)
	}
	refresh, hash, err := NewOpaqueToken()
	if err != nil {
		return Session{}, err
	}
	expires := time.Now().Add(s.refreshTTL)
	if err := qtx.InsertRefreshToken(ctx, sqlcgen.InsertRefreshTokenParams{
		UserID:    user.ID,
		FamilyID:  row.FamilyID,
		TokenHash: hash,
		ExpiresAt: expires,
	}); err != nil {
		return Session{}, fmt.Errorf("insert refresh: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit: %w", err)
	}

	return Session{User: user, AccessToken: access, RefreshToken: refresh, RefreshExpires: expires}, nil
}

// Logout revokes the presented token's whole family. Unknown tokens are fine
// — logout must always succeed from the client's perspective.
func (s *Service) Logout(ctx context.Context, rawToken string) error {
	row, err := s.q.GetRefreshToken(ctx, HashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get refresh: %w", err)
	}
	if err := s.q.RevokeRefreshFamily(ctx, row.FamilyID); err != nil {
		return fmt.Errorf("revoke family: %w", err)
	}
	return nil
}

func (s *Service) User(ctx context.Context, id int64) (sqlcgen.User, error) {
	return s.q.GetUser(ctx, id)
}

// ── Email flows ────────────────────────────────────────────────────────────

func (s *Service) SendVerification(ctx context.Context, user sqlcgen.User) error {
	if user.EmailVerifiedAt != nil {
		return nil
	}
	token, hash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	if err := s.q.InsertEmailToken(ctx, sqlcgen.InsertEmailTokenParams{
		UserID:    user.ID,
		Purpose:   sqlcgen.EmailTokenPurposeVerifyEmail,
		TokenHash: hash,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}); err != nil {
		return fmt.Errorf("insert email token: %w", err)
	}
	return s.mailer.Send(ctx, mail.Message{
		To:      user.Email,
		Subject: "Verify your Cour email",
		Body: fmt.Sprintf("Hi %s,\n\nConfirm your email address to finish setting up Cour:\n\n%s/verify-email?token=%s\n\nThis link expires in 24 hours.",
			user.Username, s.webOrigin, token),
	})
}

func (s *Service) VerifyEmail(ctx context.Context, rawToken string) error {
	row, err := s.q.ConsumeEmailToken(ctx, sqlcgen.ConsumeEmailTokenParams{
		TokenHash: HashToken(rawToken),
		Purpose:   sqlcgen.EmailTokenPurposeVerifyEmail,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidEmailToken
		}
		return fmt.Errorf("consume token: %w", err)
	}
	if err := s.q.MarkEmailVerified(ctx, row.UserID); err != nil {
		return fmt.Errorf("mark verified: %w", err)
	}
	return nil
}

// RequestPasswordReset never reveals whether the email exists.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	user, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get user: %w", err)
	}
	if user.PasswordHash == nil {
		return nil // OAuth-only account; nothing to reset
	}
	token, hash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	if err := s.q.InsertEmailToken(ctx, sqlcgen.InsertEmailTokenParams{
		UserID:    user.ID,
		Purpose:   sqlcgen.EmailTokenPurposeResetPassword,
		TokenHash: hash,
		ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		return fmt.Errorf("insert email token: %w", err)
	}
	return s.mailer.Send(ctx, mail.Message{
		To:      user.Email,
		Subject: "Reset your Cour password",
		Body: fmt.Sprintf("Hi %s,\n\nReset your password here:\n\n%s/reset-password?token=%s\n\nThis link expires in 1 hour. If you didn't request this, ignore it.",
			user.Username, s.webOrigin, token),
	})
}

func (s *Service) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	row, err := s.q.ConsumeEmailToken(ctx, sqlcgen.ConsumeEmailTokenParams{
		TokenHash: HashToken(rawToken),
		Purpose:   sqlcgen.EmailTokenPurposeResetPassword,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidEmailToken
		}
		return fmt.Errorf("consume token: %w", err)
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.q.SetPasswordHash(ctx, sqlcgen.SetPasswordHashParams{ID: row.UserID, PasswordHash: &hash}); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	// A reset invalidates every live session.
	if err := s.q.RevokeAllUserRefreshTokens(ctx, row.UserID); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return nil
}

func uniqueViolation(err error) (constraint string, ok bool) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName, true
	}
	return "", false
}
