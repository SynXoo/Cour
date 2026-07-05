package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(hash, "$argon2id$v=19$"), "PHC format")

	assert.NoError(t, VerifyPassword("correct horse battery staple", hash))
	assert.ErrorIs(t, VerifyPassword("wrong password", hash), ErrWrongPassword)
}

func TestPasswordHashesAreSalted(t *testing.T) {
	h1, err := HashPassword("same password")
	require.NoError(t, err)
	h2, err := HashPassword("same password")
	require.NoError(t, err)
	assert.NotEqual(t, h1, h2)
}

func TestVerifyPasswordRejectsGarbageHash(t *testing.T) {
	assert.Error(t, VerifyPassword("x", "not-a-hash"))
	assert.Error(t, VerifyPassword("x", "$argon2id$v=19$m=1,t=1,p=1$!!!$!!!"))
}
