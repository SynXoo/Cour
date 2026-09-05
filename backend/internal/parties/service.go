// Package parties is the watch-party domain (docs/WATCH_PARTIES.md): the
// durable room shell in Postgres — who hosts which episode, how visible it
// is, whether it is still open — and the visibility rule that gates both the
// REST view and the socket join. Live state (presence, the shared clock)
// belongs to internal/realtime, which calls back into this package.
package parties

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrNotFound       = errors.New("parties: not found")
	ErrForbidden      = errors.New("parties: not allowed")
	ErrClosed         = errors.New("parties: party is closed")
	ErrInvalidVisible = errors.New("parties: invalid visibility")
)

// View is a party joined to the rows the UI renders it with.
type View struct {
	Party         sqlcgen.WatchParty
	Episode       sqlcgen.Episode
	Anime         sqlcgen.Anime
	HostUsername  string
	HostAvatarURL *string
}

// Member is one hydrated presence entry.
type Member struct {
	ID        int64
	Username  string
	AvatarURL *string
}

type Service struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
	log  *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), log: log}
}

// ParseVisibility validates a client-supplied visibility; empty means the
// schema default (followers).
func ParseVisibility(s string) (sqlcgen.PartyVisibility, error) {
	switch sqlcgen.PartyVisibility(s) {
	case "":
		return sqlcgen.PartyVisibilityFollowers, nil
	case sqlcgen.PartyVisibilityPublic, sqlcgen.PartyVisibilityFollowers, sqlcgen.PartyVisibilityInvite:
		return sqlcgen.PartyVisibility(s), nil
	}
	return "", ErrInvalidVisible
}

// Create opens a room on an episode with the caller as host. A host runs one
// open room at a time: the caller's previous open party (if any) is closed in
// the same transaction, so the partial unique index never fires.
func (s *Service) Create(ctx context.Context, hostID, animeID int64, episodeNumber int, visibility sqlcgen.PartyVisibility) (View, error) {
	ep, err := s.q.GetEpisodeByNumber(ctx, sqlcgen.GetEpisodeByNumberParams{AnimeID: animeID, Number: int32(episodeNumber)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return View{}, ErrNotFound
		}
		return View{}, fmt.Errorf("parties: episode: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return View{}, fmt.Errorf("parties: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	if _, err := q.CloseOpenPartiesForHost(ctx, hostID); err != nil {
		return View{}, fmt.Errorf("parties: close previous: %w", err)
	}
	created, err := q.CreateParty(ctx, sqlcgen.CreatePartyParams{EpisodeID: ep.ID, HostID: hostID, Visibility: visibility})
	if err != nil {
		return View{}, fmt.Errorf("parties: create: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return View{}, fmt.Errorf("parties: commit: %w", err)
	}
	return s.view(ctx, created.ID)
}

// Get returns the party if the viewer may see it. Rooms the viewer is not
// allowed into read as ErrForbidden, never as not-found — the id is real and
// the host may still open the door (follow back, befriend).
func (s *Service) Get(ctx context.Context, viewerID, partyID int64) (View, error) {
	v, err := s.view(ctx, partyID)
	if err != nil {
		return View{}, err
	}
	ok, err := s.canView(ctx, viewerID, v.Party)
	if err != nil {
		return View{}, err
	}
	if !ok {
		return View{}, ErrForbidden
	}
	return v, nil
}

// Joinable is Get plus the open check — the socket's join gate.
func (s *Service) Joinable(ctx context.Context, viewerID, partyID int64) (View, error) {
	v, err := s.Get(ctx, viewerID, partyID)
	if err != nil {
		return View{}, err
	}
	if v.Party.ClosedAt != nil {
		return View{}, ErrClosed
	}
	return v, nil
}

func (s *Service) view(ctx context.Context, id int64) (View, error) {
	row, err := s.q.GetPartyView(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return View{}, ErrNotFound
		}
		return View{}, fmt.Errorf("parties: get: %w", err)
	}
	return View{
		Party:         row.WatchParty,
		Episode:       row.Episode,
		Anime:         row.Anime,
		HostUsername:  row.HostUsername,
		HostAvatarURL: row.HostAvatarUrl,
	}, nil
}

// canView is the visibility rule. public: any signed-in user. followers: the
// host's followers, plus friends (a friendship is stronger than a follow).
// invite: the host's friends until explicit invites exist (M4.4). The host
// always sees their own room.
func (s *Service) canView(ctx context.Context, viewerID int64, p sqlcgen.WatchParty) (bool, error) {
	if viewerID == p.HostID {
		return true, nil
	}
	switch p.Visibility {
	case sqlcgen.PartyVisibilityPublic:
		return true, nil
	case sqlcgen.PartyVisibilityFollowers:
		following, err := s.q.IsFollowing(ctx, sqlcgen.IsFollowingParams{FollowerID: viewerID, FolloweeID: p.HostID})
		if err != nil {
			return false, fmt.Errorf("parties: is following: %w", err)
		}
		if following {
			return true, nil
		}
		return s.areFriends(ctx, viewerID, p.HostID)
	case sqlcgen.PartyVisibilityInvite:
		return s.areFriends(ctx, viewerID, p.HostID)
	}
	return false, nil
}

func (s *Service) areFriends(ctx context.Context, a, b int64) (bool, error) {
	ok, err := s.q.AreFriends(ctx, sqlcgen.AreFriendsParams{Column1: a, Column2: b})
	if err != nil {
		return false, fmt.Errorf("parties: are friends: %w", err)
	}
	return ok, nil
}

// Close ends a party as its host. Not-found and not-yours both surface (a
// stranger can't probe ids); an already-closed room is a no-op success.
func (s *Service) Close(ctx context.Context, hostID, partyID int64) error {
	v, err := s.view(ctx, partyID)
	if err != nil {
		return err
	}
	if v.Party.HostID != hostID {
		return ErrForbidden
	}
	if _, err := s.q.CloseParty(ctx, sqlcgen.ClosePartyParams{ID: partyID, HostID: hostID}); err != nil {
		return fmt.Errorf("parties: close: %w", err)
	}
	return nil
}

// CloseByID is the idle sweeper's close (no host check). Returns whether
// the row changed, so the caller only broadcasts for rooms it actually ended.
func (s *Service) CloseByID(ctx context.Context, partyID int64) (bool, error) {
	n, err := s.q.ClosePartyByID(ctx, partyID)
	if err != nil {
		return false, fmt.Errorf("parties: close by id: %w", err)
	}
	return n > 0, nil
}

// OpenRoom is one row of the idle sweeper's scan.
type OpenRoom struct {
	ID        int64
	CreatedAt time.Time
}

// ListOpenIDs is every open room (the idle sweeper's input).
func (s *Service) ListOpenIDs(ctx context.Context) ([]OpenRoom, error) {
	rows, err := s.q.ListOpenPartyIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("parties: list open ids: %w", err)
	}
	out := make([]OpenRoom, len(rows))
	for i, r := range rows {
		out[i] = OpenRoom{ID: r.ID, CreatedAt: r.CreatedAt}
	}
	return out, nil
}

// ListOpen is discovery: open rooms the viewer may join (nil viewer =
// anonymous, public only), newest first, optionally scoped to one episode.
func (s *Service) ListOpen(ctx context.Context, viewerID *int64, animeID *int64, episode *int32, limit int32) ([]View, error) {
	rows, err := s.q.ListOpenPartiesVisible(ctx, sqlcgen.ListOpenPartiesVisibleParams{
		Limit: limit, AnimeID: animeID, Episode: episode, Viewer: viewerID,
	})
	if err != nil {
		return nil, fmt.Errorf("parties: list open: %w", err)
	}
	out := make([]View, len(rows))
	for i, row := range rows {
		out[i] = View{
			Party:         row.WatchParty,
			Episode:       row.Episode,
			Anime:         row.Anime,
			HostUsername:  row.HostUsername,
			HostAvatarURL: row.HostAvatarUrl,
		}
	}
	return out, nil
}

// Members hydrates presence ids into display rows, preserving the given
// order (the presence set is ordered by arrival). Ids that no longer resolve
// (a deleted account mid-party) are dropped.
func (s *Service) Members(ctx context.Context, ids []int64) ([]Member, error) {
	if len(ids) == 0 {
		return []Member{}, nil
	}
	rows, err := s.q.ListUsersByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("parties: members: %w", err)
	}
	byID := make(map[int64]sqlcgen.ListUsersByIDsRow, len(rows))
	for _, r := range rows {
		byID[r.ID] = r
	}
	out := make([]Member, 0, len(ids))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, Member{ID: r.ID, Username: r.Username, AvatarURL: r.AvatarUrl})
		}
	}
	return out, nil
}
