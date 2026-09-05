package social

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"cour/internal/store/sqlcgen"
)

// FriendshipStatus is the caller's standing with another user.
type FriendshipStatus string

const (
	FriendshipNone            FriendshipStatus = "none"
	FriendshipFriends         FriendshipStatus = "friends"
	FriendshipRequestSent     FriendshipStatus = "request_sent"
	FriendshipRequestReceived FriendshipStatus = "request_received"
	FriendshipSelf            FriendshipStatus = "self"
)

const (
	maxRequestNote        = 200
	maxRecommendationNote = 500
	friendRecsDefault     = 12
)

// friendshipOf resolves the caller's standing with userID; anonymous
// callers are always `none`.
func (s *Service) friendshipOf(ctx context.Context, callerID *int64, userID int64) (FriendshipStatus, error) {
	if callerID == nil {
		return FriendshipNone, nil
	}
	if *callerID == userID {
		return FriendshipSelf, nil
	}
	pair := sqlcgen.AreFriendsParams{Column1: *callerID, Column2: userID}
	friends, err := s.q.AreFriends(ctx, pair)
	if err != nil {
		return "", fmt.Errorf("are friends: %w", err)
	}
	if friends {
		return FriendshipFriends, nil
	}
	sent, err := s.q.FriendRequestExists(ctx, sqlcgen.FriendRequestExistsParams{RequesterID: *callerID, AddresseeID: userID})
	if err != nil {
		return "", fmt.Errorf("request sent: %w", err)
	}
	if sent {
		return FriendshipRequestSent, nil
	}
	received, err := s.q.FriendRequestExists(ctx, sqlcgen.FriendRequestExistsParams{RequesterID: userID, AddresseeID: *callerID})
	if err != nil {
		return "", fmt.Errorf("request received: %w", err)
	}
	if received {
		return FriendshipRequestReceived, nil
	}
	return FriendshipNone, nil
}

// Befriend is the "add friend" verb: it sends a request, or — when the other
// person already asked — accepts it. Mutual intent is a friendship, not a
// second pending row. Accepting also follows both ways inside the same
// transaction so friends land in each other's feed; those auto-follows
// deliberately raise no new-follower notification (the accept is the news).
func (s *Service) Befriend(ctx context.Context, callerID int64, username, note string) (RelationState, error) {
	target, err := s.resolve(ctx, username)
	if err != nil {
		return RelationState{}, err
	}
	if target.ID == callerID {
		return RelationState{}, ErrSelfFriend
	}
	note = clampNote(note, maxRequestNote)

	already, err := s.q.AreFriends(ctx, sqlcgen.AreFriendsParams{Column1: callerID, Column2: target.ID})
	if err != nil {
		return RelationState{}, fmt.Errorf("are friends: %w", err)
	}
	if already {
		return s.relationOf(ctx, &callerID, target.ID)
	}

	theirs, err := s.q.FriendRequestExists(ctx, sqlcgen.FriendRequestExistsParams{RequesterID: target.ID, AddresseeID: callerID})
	if err != nil {
		return RelationState{}, fmt.Errorf("request exists: %w", err)
	}
	if theirs {
		if err := s.accept(ctx, callerID, target.ID); err != nil {
			return RelationState{}, err
		}
		if s.notifier != nil {
			s.notifier.FriendAccepted(ctx, callerID, target.ID)
		}
		return s.relationOf(ctx, &callerID, target.ID)
	}

	n, err := s.q.CreateFriendRequest(ctx, sqlcgen.CreateFriendRequestParams{
		RequesterID: callerID, AddresseeID: target.ID, Note: note,
	})
	if err != nil {
		return RelationState{}, fmt.Errorf("create request: %w", err)
	}
	if n > 0 && s.notifier != nil {
		s.notifier.FriendRequested(ctx, callerID, target.ID, note)
	}
	return s.relationOf(ctx, &callerID, target.ID)
}

// accept turns the pending request from requesterID into a friendship.
func (s *Service) accept(ctx context.Context, accepterID, requesterID int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	if _, err := qtx.DeleteFriendRequest(ctx, sqlcgen.DeleteFriendRequestParams{RequesterID: requesterID, AddresseeID: accepterID}); err != nil {
		return fmt.Errorf("delete request: %w", err)
	}
	if _, err := qtx.CreateFriendship(ctx, sqlcgen.CreateFriendshipParams{Column1: accepterID, Column2: requesterID}); err != nil {
		return fmt.Errorf("create friendship: %w", err)
	}
	if _, err := qtx.Follow(ctx, sqlcgen.FollowParams{FollowerID: accepterID, FolloweeID: requesterID}); err != nil {
		return fmt.Errorf("auto-follow: %w", err)
	}
	if _, err := qtx.Follow(ctx, sqlcgen.FollowParams{FollowerID: requesterID, FolloweeID: accepterID}); err != nil {
		return fmt.Errorf("auto-follow back: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// Unfriend means "no relationship": it cancels the caller's outgoing
// request, declines the other side's, or ends the friendship — whichever
// the current state is. Follows are left alone; they're the person's own.
func (s *Service) Unfriend(ctx context.Context, callerID int64, username string) (RelationState, error) {
	target, err := s.resolve(ctx, username)
	if err != nil {
		return RelationState{}, err
	}
	if target.ID == callerID {
		return RelationState{}, ErrSelfFriend
	}
	if _, err := s.q.DeleteFriendRequest(ctx, sqlcgen.DeleteFriendRequestParams{RequesterID: callerID, AddresseeID: target.ID}); err != nil {
		return RelationState{}, fmt.Errorf("cancel request: %w", err)
	}
	if _, err := s.q.DeleteFriendRequest(ctx, sqlcgen.DeleteFriendRequestParams{RequesterID: target.ID, AddresseeID: callerID}); err != nil {
		return RelationState{}, fmt.Errorf("decline request: %w", err)
	}
	if _, err := s.q.DeleteFriendship(ctx, sqlcgen.DeleteFriendshipParams{Column1: callerID, Column2: target.ID}); err != nil {
		return RelationState{}, fmt.Errorf("delete friendship: %w", err)
	}
	return s.relationOf(ctx, &callerID, target.ID)
}

// FriendsOverview is the /friends hub in one read.
type FriendsOverview struct {
	Friends   []sqlcgen.ListFriendsRow
	Incoming  []sqlcgen.ListIncomingFriendRequestsRow
	Outgoing  []sqlcgen.ListOutgoingFriendRequestsRow
	Suggested []sqlcgen.SuggestedFriendsRow
}

func (s *Service) Overview(ctx context.Context, userID int64) (FriendsOverview, error) {
	var out FriendsOverview
	var err error
	if out.Friends, err = s.q.ListFriends(ctx, sqlcgen.ListFriendsParams{UserA: userID, Limit: 500}); err != nil {
		return out, fmt.Errorf("friends: %w", err)
	}
	if out.Incoming, err = s.q.ListIncomingFriendRequests(ctx, userID); err != nil {
		return out, fmt.Errorf("incoming: %w", err)
	}
	if out.Outgoing, err = s.q.ListOutgoingFriendRequests(ctx, userID); err != nil {
		return out, fmt.Errorf("outgoing: %w", err)
	}
	if out.Suggested, err = s.q.SuggestedFriends(ctx, userID); err != nil {
		return out, fmt.Errorf("suggested: %w", err)
	}
	return out, nil
}

// FriendsOf is the public friends list on a profile.
func (s *Service) FriendsOf(ctx context.Context, username string) ([]sqlcgen.ListFriendsRow, error) {
	user, err := s.resolve(ctx, username)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListFriends(ctx, sqlcgen.ListFriendsParams{UserA: user.ID, Limit: listLimit})
	if err != nil {
		return nil, fmt.Errorf("friends of: %w", err)
	}
	return rows, nil
}

// FriendsOnAnime lists the caller's friends who track a show, plus the
// recommendations the caller received for it.
func (s *Service) FriendsOnAnime(ctx context.Context, userID, animeID int64) ([]sqlcgen.FriendsOnAnimeRow, []sqlcgen.RecommendationsForAnimeRow, error) {
	rows, err := s.q.FriendsOnAnime(ctx, sqlcgen.FriendsOnAnimeParams{UserA: userID, AnimeID: animeID})
	if err != nil {
		return nil, nil, fmt.Errorf("friends on anime: %w", err)
	}
	recs, err := s.q.RecommendationsForAnime(ctx, sqlcgen.RecommendationsForAnimeParams{ToUserID: userID, AnimeID: animeID})
	if err != nil {
		return nil, nil, fmt.Errorf("recommendations: %w", err)
	}
	return rows, recs, nil
}

// Recommend sends a show to a friend with a note. Friends only: the
// friendship is the spam gate.
func (s *Service) Recommend(ctx context.Context, fromID, animeID int64, toUsername, note string) error {
	to, err := s.resolve(ctx, toUsername)
	if err != nil {
		return err
	}
	if to.ID == fromID {
		return ErrSelfFriend
	}
	friends, err := s.q.AreFriends(ctx, sqlcgen.AreFriendsParams{Column1: fromID, Column2: to.ID})
	if err != nil {
		return fmt.Errorf("are friends: %w", err)
	}
	if !friends {
		return ErrNotFriends
	}
	if _, err := s.q.GetAnime(ctx, animeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAnimeNotFound
		}
		return fmt.Errorf("get anime: %w", err)
	}
	note = clampNote(note, maxRecommendationNote)
	if _, err := s.q.UpsertRecommendation(ctx, sqlcgen.UpsertRecommendationParams{
		FromUserID: fromID, ToUserID: to.ID, AnimeID: animeID, Note: note,
	}); err != nil {
		return fmt.Errorf("upsert recommendation: %w", err)
	}
	if s.notifier != nil {
		s.notifier.Recommended(ctx, fromID, to.ID, animeID, note)
	}
	return nil
}

// FriendRecommendations feeds the home's "friends think you'd like" row.
func (s *Service) FriendRecommendations(ctx context.Context, userID int64, limit int) ([]sqlcgen.ListFriendRecommendationsRow, error) {
	if limit <= 0 {
		limit = friendRecsDefault
	}
	rows, err := s.q.ListFriendRecommendations(ctx, sqlcgen.ListFriendRecommendationsParams{ToUserID: userID, Limit: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("friend recommendations: %w", err)
	}
	return rows, nil
}

// SearchUsers backs the "find people" box.
func (s *Service) SearchUsers(ctx context.Context, q string) ([]sqlcgen.SearchUsersRow, error) {
	q = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(q), "@"))
	if q == "" {
		return []sqlcgen.SearchUsersRow{}, nil
	}
	rows, err := s.q.SearchUsers(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	return rows, nil
}

// clampNote trims and caps a free-text note at max runes (never mid-rune).
func clampNote(note string, max int) string {
	note = strings.TrimSpace(note)
	if r := []rune(note); len(r) > max {
		note = string(r[:max])
	}
	return note
}
