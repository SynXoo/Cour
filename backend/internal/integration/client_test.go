//go:build integration

package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"testing"

	"github.com/stretchr/testify/require"
)

// apiClient is a per-user test client: its own cookie jar (refresh cookie)
// and bearer token.
type apiClient struct {
	t     *testing.T
	http  *http.Client
	token string
}

func newClient(t *testing.T) *apiClient {
	t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	return &apiClient{t: t, http: &http.Client{Jar: jar}}
}

// do sends a JSON request and decodes the response into out (when non-nil).
// It returns the HTTP status; the body is fully consumed and closed here.
func (c *apiClient) do(method, path string, body any, out any) int {
	c.t.Helper()

	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(c.t, err)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}

	req, err := http.NewRequest(method, testServer.URL+path, reader)
	require.NoError(c.t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "test")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	require.NoError(c.t, err)
	defer func() { _ = resp.Body.Close() }()

	if out != nil {
		require.NoError(c.t, json.NewDecoder(resp.Body).Decode(out),
			"decoding %s %s (status %d)", method, path, resp.StatusCode)
	}
	return resp.StatusCode
}

type sessionResponse struct {
	AccessToken string `json:"access_token"`
	User        struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	} `json:"user"`
}

// register creates a fresh user and leaves the client authenticated.
func (c *apiClient) register(name string) sessionResponse {
	c.t.Helper()
	var session sessionResponse
	status := c.do(http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email":    fmt.Sprintf("%s@test.local", name),
		"username": name,
		"password": "integration-pw-1",
	}, &session)
	require.Equal(c.t, http.StatusCreated, status)
	require.NotEmpty(c.t, session.AccessToken)
	c.token = session.AccessToken
	return session
}
