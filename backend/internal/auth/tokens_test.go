package auth

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccessTokenRoundTrip(t *testing.T) {
	ti, ephemeral, err := NewTokenIssuer("", 15*time.Minute)
	require.NoError(t, err)
	assert.True(t, ephemeral)

	token, err := ti.IssueAccess(42, "miguel", "user", time.Now())
	require.NoError(t, err)

	claims, err := ti.ParseAccess(token)
	require.NoError(t, err)
	id, err := claims.UserID()
	require.NoError(t, err)
	assert.EqualValues(t, 42, id)
	assert.Equal(t, "miguel", claims.Username)
	assert.Equal(t, "user", claims.Role)
}

func TestAccessTokenExpires(t *testing.T) {
	ti, _, err := NewTokenIssuer("", time.Minute)
	require.NoError(t, err)

	token, err := ti.IssueAccess(1, "u", "user", time.Now().Add(-time.Hour))
	require.NoError(t, err)
	_, err = ti.ParseAccess(token)
	assert.ErrorIs(t, err, ErrInvalidToken)
}

func TestSeededIssuerIsDeterministic(t *testing.T) {
	seed := base64.StdEncoding.EncodeToString(make([]byte, 32))
	a, ephemeral, err := NewTokenIssuer(seed, time.Minute)
	require.NoError(t, err)
	assert.False(t, ephemeral)
	b, _, err := NewTokenIssuer(seed, time.Minute)
	require.NoError(t, err)

	// Token from issuer A must verify under issuer B (same key material) —
	// this is what lets multiple API instances share sessions.
	token, err := a.IssueAccess(7, "u", "user", time.Now())
	require.NoError(t, err)
	_, err = b.ParseAccess(token)
	assert.NoError(t, err)
}

func TestIssuerRejectsBadSeed(t *testing.T) {
	_, _, err := NewTokenIssuer("tooshort", time.Minute)
	assert.Error(t, err)
}

func TestOpaqueTokensAreUniqueAndHashable(t *testing.T) {
	t1, h1, err := NewOpaqueToken()
	require.NoError(t, err)
	t2, h2, err := NewOpaqueToken()
	require.NoError(t, err)

	assert.NotEqual(t, t1, t2)
	assert.NotEqual(t, h1, h2)
	assert.Equal(t, HashToken(t1), h1)
	assert.Len(t, h1, 32)
}
