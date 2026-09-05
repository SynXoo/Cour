// Package social implements the follow graph, friendships layered on top of
// it, friend-to-friend recommendations, direct messages, and the activity
// feed (fan-out-on-read: the feed is a keyset query over followees'
// activities; see docs/ARCHITECTURE.md for the write-side upgrade path).
package social

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrUserNotFound  = errors.New("social: user not found")
	ErrSelfFollow    = errors.New("social: cannot follow yourself")
	ErrSelfFriend    = errors.New("social: cannot befriend yourself")
	ErrNotFriends    = errors.New("social: not friends")
	ErrAnimeNotFound = errors.New("social: anime not found")
	ErrEmptyMessage  = errors.New("social: message body required")
)

// Notifier is the notification seam (implemented by notify.Enqueuer).
// Every method is fire-and-forget: the user action never waits on fan-out.
type Notifier interface {
	Followed(ctx context.Context, followerID, followeeID int64)
	FriendRequested(ctx context.Context, requesterID, addresseeID int64, note string)
	FriendAccepted(ctx context.Context, accepterID, requesterID int64)
	Recommended(ctx context.Context, fromID, toID, animeID int64, note string)
}

type Service struct {
	q        *sqlcgen.Queries
	pool     *pgxpool.Pool
	notifier Notifier // nil-safe
	log      *slog.Logger
}

func New(pool *pgxpool.Pool, notifier Notifier, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), pool: pool, notifier: notifier, log: log}
}

func (s *Service) resolve(ctx context.Context, username string) (sqlcgen.User, error) {
	user, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.User{}, ErrUserNotFound
		}
		return sqlcgen.User{}, fmt.Errorf("get user: %w", err)
	}
	return user, nil
}

func (s *Service) Follow(ctx context.Context, followerID int64, username string) (RelationState, error) {
	followee, err := s.resolve(ctx, username)
	if err != nil {
		return RelationState{}, err
	}
	if followee.ID == followerID {
		return RelationState{}, ErrSelfFollow
	}
	n, err := s.q.Follow(ctx, sqlcgen.FollowParams{FollowerID: followerID, FolloweeID: followee.ID})
	if err != nil {
		return RelationState{}, fmt.Errorf("follow: %w", err)
	}
	if n > 0 && s.notifier != nil {
		s.notifier.Followed(ctx, followerID, followee.ID)
	}
	return s.relationOf(ctx, &followerID, followee.ID)
}

func (s *Service) Unfollow(ctx context.Context, followerID int64, username string) (RelationState, error) {
	followee, err := s.resolve(ctx, username)
	if err != nil {
		return RelationState{}, err
	}
	if _, err := s.q.Unfollow(ctx, sqlcgen.UnfollowParams{FollowerID: followerID, FolloweeID: followee.ID}); err != nil {
		return RelationState{}, fmt.Errorf("unfollow: %w", err)
	}
	return s.relationOf(ctx, &followerID, followee.ID)
}

// RelationState is everything the profile's relationship row needs in one
// read: the follow counts and the caller's follow + friendship standing.
type RelationState struct {
	Followers   int64
	Following   int64
	Friends     int64
	IsFollowing bool
	Friendship  FriendshipStatus
}

func (s *Service) Relation(ctx context.Context, callerID *int64, username string) (RelationState, error) {
	user, err := s.resolve(ctx, username)
	if err != nil {
		return RelationState{}, err
	}
	return s.relationOf(ctx, callerID, user.ID)
}

func (s *Service) relationOf(ctx context.Context, callerID *int64, userID int64) (RelationState, error) {
	counts, err := s.q.FollowCounts(ctx, userID)
	if err != nil {
		return RelationState{}, fmt.Errorf("counts: %w", err)
	}
	friends, err := s.q.FriendCount(ctx, userID)
	if err != nil {
		return RelationState{}, fmt.Errorf("friend count: %w", err)
	}
	state := RelationState{
		Followers:  counts.Followers,
		Following:  counts.Following,
		Friends:    friends,
		Friendship: FriendshipNone,
	}
	if callerID != nil && *callerID != userID {
		following, err := s.q.IsFollowing(ctx, sqlcgen.IsFollowingParams{
			FollowerID: *callerID, FolloweeID: userID,
		})
		if err != nil {
			return RelationState{}, fmt.Errorf("is following: %w", err)
		}
		state.IsFollowing = following
	}
	friendship, err := s.friendshipOf(ctx, callerID, userID)
	if err != nil {
		return RelationState{}, err
	}
	state.Friendship = friendship
	return state, nil
}

const listLimit = 100

func (s *Service) Followers(ctx context.Context, username string) ([]sqlcgen.ListFollowersRow, error) {
	user, err := s.resolve(ctx, username)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListFollowers(ctx, sqlcgen.ListFollowersParams{FolloweeID: user.ID, Limit: listLimit})
	if err != nil {
		return nil, fmt.Errorf("followers: %w", err)
	}
	return rows, nil
}

func (s *Service) Following(ctx context.Context, username string) ([]sqlcgen.ListFollowingRow, error) {
	user, err := s.resolve(ctx, username)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListFollowing(ctx, sqlcgen.ListFollowingParams{FollowerID: user.ID, Limit: listLimit})
	if err != nil {
		return nil, fmt.Errorf("following: %w", err)
	}
	return rows, nil
}

// FeedScope selects whose activity a feed page covers.
type FeedScope string

const (
	FeedEveryone FeedScope = "all"
	FeedFriends  FeedScope = "friends"
)

// Feed returns one page of followees' (or friends') activities plus the
// cursor for the next (0 = end).
func (s *Service) Feed(ctx context.Context, userID int64, scope FeedScope, cursor int64, limit int) ([]sqlcgen.FeedActivitiesRow, int64, error) {
	if cursor <= 0 {
		cursor = math.MaxInt64
	}
	var rows []sqlcgen.FeedActivitiesRow
	if scope == FeedFriends {
		friendRows, err := s.q.FeedActivitiesFriends(ctx, sqlcgen.FeedActivitiesFriendsParams{
			UserA: userID,
			ID:    cursor,
			Limit: int32(limit) + 1,
		})
		if err != nil {
			return nil, 0, fmt.Errorf("friends feed: %w", err)
		}
		rows = make([]sqlcgen.FeedActivitiesRow, len(friendRows))
		for i, r := range friendRows {
			rows[i] = sqlcgen.FeedActivitiesRow(r)
		}
	} else {
		var err error
		rows, err = s.q.FeedActivities(ctx, sqlcgen.FeedActivitiesParams{
			FollowerID: userID,
			ID:         cursor,
			Limit:      int32(limit) + 1,
		})
		if err != nil {
			return nil, 0, fmt.Errorf("feed: %w", err)
		}
	}
	var next int64
	if len(rows) > limit {
		rows = rows[:limit]
		next = rows[len(rows)-1].Activity.ID
	}
	return rows, next, nil
}
