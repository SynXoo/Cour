package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"cour/internal/store/sqlcgen"
)

// Discord OAuth: code flow against discord.com, linking accounts by
// discord_id. Only active when client credentials are configured.
type Discord struct {
	ClientID    string
	Secret      string
	RedirectURI string
	HTTP        *http.Client

	tokenURL string
	userURL  string
}

func NewDiscord(clientID, secret, redirectURI string) *Discord {
	return &Discord{
		ClientID:    clientID,
		Secret:      secret,
		RedirectURI: redirectURI,
		HTTP:        &http.Client{Timeout: 15 * time.Second},
		tokenURL:    "https://discord.com/api/oauth2/token",
		userURL:     "https://discord.com/api/users/@me",
	}
}

func (d *Discord) AuthURL(state string) string {
	q := url.Values{
		"client_id":     {d.ClientID},
		"redirect_uri":  {d.RedirectURI},
		"response_type": {"code"},
		"scope":         {"identify email"},
		"state":         {state},
		"prompt":        {"consent"},
	}
	return "https://discord.com/oauth2/authorize?" + q.Encode()
}

type discordUser struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Email    *string `json:"email"`
	Verified bool    `json:"verified"`
	Avatar   *string `json:"avatar"`
}

func (d *Discord) exchange(ctx context.Context, code string) (string, error) {
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {d.RedirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(d.ClientID, d.Secret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := d.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("discord token exchange: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("discord token exchange: %s: %s", resp.Status, body)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("discord token decode: %w", err)
	}
	return out.AccessToken, nil
}

func (d *Discord) fetchUser(ctx context.Context, accessToken string) (discordUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.userURL, nil)
	if err != nil {
		return discordUser{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := d.HTTP.Do(req)
	if err != nil {
		return discordUser{}, fmt.Errorf("discord user fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return discordUser{}, fmt.Errorf("discord user fetch: %s", resp.Status)
	}
	var u discordUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return discordUser{}, fmt.Errorf("discord user decode: %w", err)
	}
	return u, nil
}

var ErrDiscordNoEmail = errors.New("auth: discord account has no verified email")

// DiscordLogin completes the callback: exchanges the code, then finds or
// creates the matching Cour account and issues a session.
func (s *Service) DiscordLogin(ctx context.Context, d *Discord, code string) (Session, error) {
	token, err := d.exchange(ctx, code)
	if err != nil {
		return Session{}, err
	}
	du, err := d.fetchUser(ctx, token)
	if err != nil {
		return Session{}, err
	}

	// Already linked?
	if user, err := s.q.GetUserByDiscordID(ctx, &du.ID); err == nil {
		return s.issueSession(ctx, user)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Session{}, fmt.Errorf("get by discord id: %w", err)
	}

	if du.Email == nil || !du.Verified {
		return Session{}, ErrDiscordNoEmail
	}
	email := strings.ToLower(*du.Email)
	avatarURL := discordAvatarURL(du)

	// Same email already registered -> link Discord to that account. Safe
	// because Discord attested the address is verified on their side.
	if user, err := s.q.GetUserByEmail(ctx, email); err == nil {
		if err := s.q.LinkDiscord(ctx, sqlcgen.LinkDiscordParams{
			ID: user.ID, DiscordID: &du.ID, AvatarUrl: avatarURL,
		}); err != nil {
			return Session{}, fmt.Errorf("link discord: %w", err)
		}
		return s.issueSession(ctx, user)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Session{}, fmt.Errorf("get by email: %w", err)
	}

	username, err := s.availableUsername(ctx, du.Username)
	if err != nil {
		return Session{}, err
	}
	user, err := s.q.CreateDiscordUser(ctx, sqlcgen.CreateDiscordUserParams{
		Email:     email,
		Username:  username,
		DiscordID: &du.ID,
		AvatarUrl: avatarURL,
	})
	if err != nil {
		return Session{}, fmt.Errorf("create discord user: %w", err)
	}
	return s.issueSession(ctx, user)
}

var usernameStrip = regexp.MustCompile(`[^a-zA-Z0-9_]+`)

// availableUsername sanitizes a Discord handle into Cour's username rules
// and suffixes digits until free.
func (s *Service) availableUsername(ctx context.Context, base string) (string, error) {
	name := usernameStrip.ReplaceAllString(base, "")
	if len(name) > 16 {
		name = name[:16]
	}
	for len(name) < 3 {
		name += "0"
	}
	candidate := name
	for i := 0; i < 50; i++ {
		if i > 0 {
			candidate = fmt.Sprintf("%s%d", name, i)
		}
		taken, err := s.q.UsernameExists(ctx, candidate)
		if err != nil {
			return "", fmt.Errorf("username exists: %w", err)
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", errors.New("auth: could not find a free username")
}

func discordAvatarURL(u discordUser) *string {
	if u.Avatar == nil {
		return nil
	}
	url := fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", u.ID, *u.Avatar)
	return &url
}
