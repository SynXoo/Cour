//go:build integration

package integration

import (
	"net/url"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	// Cookie jars key on the path too; the refresh cookie is scoped to
	// /api/v1/auth, so use that path when reading it back.
	u.Path = "/api/v1/auth"
	return u
}
