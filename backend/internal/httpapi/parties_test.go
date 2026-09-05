package httpapi

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"cour/internal/config"
)

func TestSocketOrigins(t *testing.T) {
	// Production: exactly the web origin's host.
	assert.Equal(t, []string{"cour.app"},
		socketOrigins(config.Config{Env: "prod", WebOrigin: "https://cour.app"}))
	// Dev env: the origin plus any localhost port (preview servers).
	assert.Equal(t, []string{"localhost:3000", "localhost:*", "127.0.0.1:*"},
		socketOrigins(config.Config{Env: "dev", WebOrigin: "http://localhost:3000"}))
	// A prod-env stack whose web origin is localhost (the compose demo) is
	// local too.
	assert.Equal(t, []string{"localhost:3000", "localhost:*", "127.0.0.1:*"},
		socketOrigins(config.Config{Env: "prod", WebOrigin: "http://localhost:3000"}))
	assert.Equal(t, []string{"localhost:*", "127.0.0.1:*"},
		socketOrigins(config.Config{Env: "dev", WebOrigin: "not a url"}))
}
