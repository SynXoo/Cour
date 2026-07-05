package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenIssuer signs short-lived access JWTs (Ed25519) and mints opaque
// refresh tokens.
type TokenIssuer struct {
	priv      ed25519.PrivateKey
	pub       ed25519.PublicKey
	accessTTL time.Duration
}

// NewTokenIssuer derives the signing key from a base64-encoded 32-byte seed.
// An empty seed generates an ephemeral key (dev only — sessions die with the
// process; config forbids it in prod).
func NewTokenIssuer(seedB64 string, accessTTL time.Duration) (*TokenIssuer, bool, error) {
	if seedB64 == "" {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, false, fmt.Errorf("auth: generate ephemeral key: %w", err)
		}
		return &TokenIssuer{priv: priv, pub: pub, accessTTL: accessTTL}, true, nil
	}
	seed, err := base64.StdEncoding.DecodeString(seedB64)
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, false, errors.New("auth: AUTH_TOKEN_SEED must be base64 of exactly 32 bytes")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return &TokenIssuer{
		priv:      priv,
		pub:       priv.Public().(ed25519.PublicKey),
		accessTTL: accessTTL,
	}, false, nil
}

type AccessClaims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func (ti *TokenIssuer) AccessTTL() time.Duration { return ti.accessTTL }

func (ti *TokenIssuer) IssueAccess(userID int64, username, role string, now time.Time) (string, error) {
	claims := AccessClaims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			Issuer:    "cour",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ti.accessTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(ti.priv)
}

var ErrInvalidToken = errors.New("auth: invalid token")

// ParseAccess validates signature, expiry, and issuer, returning the claims.
func (ti *TokenIssuer) ParseAccess(token string) (AccessClaims, error) {
	var claims AccessClaims
	_, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return ti.pub, nil
	}, jwt.WithIssuer("cour"), jwt.WithExpirationRequired())
	if err != nil {
		return AccessClaims{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	return claims, nil
}

func (c AccessClaims) UserID() (int64, error) {
	return strconv.ParseInt(c.Subject, 10, 64)
}

// NewOpaqueToken returns a 256-bit random token (URL-safe base64) and its
// sha256 digest. Only the digest is stored.
func NewOpaqueToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("auth: random token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashToken(token), nil
}

func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
