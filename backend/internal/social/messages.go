package social

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"cour/internal/store/sqlcgen"
)

const maxMessageChars = 2000

// Inbox lists every conversation the viewer is in, newest activity first.
func (s *Service) Inbox(ctx context.Context, userID int64) ([]sqlcgen.ListDMInboxRow, error) {
	rows, err := s.q.ListDMInbox(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("inbox: %w", err)
	}
	return rows, nil
}

// UnreadMessages counts the peer messages past the viewer's read pointers.
func (s *Service) UnreadMessages(ctx context.Context, userID int64) (int64, error) {
	n, err := s.q.CountUnreadDMs(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("unread messages: %w", err)
	}
	return n, nil
}

// Conversation returns one newest-first page with the peer and the cursor
// for older messages (0 = end). A pair with no thread yet is an empty page,
// friends or not — the UI decides what to say.
func (s *Service) Conversation(ctx context.Context, userID int64, username string, beforeID int64, limit int) (peer sqlcgen.User, msgs []sqlcgen.DmMessage, next int64, err error) {
	peer, err = s.resolve(ctx, username)
	if err != nil {
		return peer, nil, 0, err
	}
	if peer.ID == userID {
		return peer, nil, 0, ErrSelfFriend
	}
	thread, err := s.q.GetDMThread(ctx, sqlcgen.GetDMThreadParams{Column1: userID, Column2: peer.ID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return peer, []sqlcgen.DmMessage{}, 0, nil
		}
		return peer, nil, 0, fmt.Errorf("get thread: %w", err)
	}
	if beforeID <= 0 {
		beforeID = math.MaxInt64
	}
	msgs, err = s.q.ListDMMessages(ctx, sqlcgen.ListDMMessagesParams{ThreadID: thread.ID, ID: beforeID, Limit: int32(limit) + 1})
	if err != nil {
		return peer, nil, 0, fmt.Errorf("list messages: %w", err)
	}
	if len(msgs) > limit {
		msgs = msgs[:limit]
		next = msgs[len(msgs)-1].ID
	}
	return peer, msgs, next, nil
}

// Send appends a message to the pair's thread (creating it on first
// contact). Friends only.
func (s *Service) Send(ctx context.Context, userID int64, username, body string) (sqlcgen.DmMessage, error) {
	peer, err := s.resolve(ctx, username)
	if err != nil {
		return sqlcgen.DmMessage{}, err
	}
	if peer.ID == userID {
		return sqlcgen.DmMessage{}, ErrSelfFriend
	}
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > maxMessageChars {
		return sqlcgen.DmMessage{}, ErrEmptyMessage
	}
	friends, err := s.q.AreFriends(ctx, sqlcgen.AreFriendsParams{Column1: userID, Column2: peer.ID})
	if err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("are friends: %w", err)
	}
	if !friends {
		return sqlcgen.DmMessage{}, ErrNotFriends
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	thread, err := qtx.GetOrCreateDMThread(ctx, sqlcgen.GetOrCreateDMThreadParams{Column1: userID, Column2: peer.ID})
	if err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("thread: %w", err)
	}
	msg, err := qtx.InsertDMMessage(ctx, sqlcgen.InsertDMMessageParams{ThreadID: thread.ID, SenderID: userID, Body: body})
	if err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("insert message: %w", err)
	}
	if err := qtx.TouchDMThread(ctx, sqlcgen.TouchDMThreadParams{Sender: userID, Message: msg.ID, Thread: thread.ID}); err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("touch thread: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.DmMessage{}, fmt.Errorf("commit: %w", err)
	}
	return msg, nil
}

// MarkRead moves the viewer's pointer to the end of the conversation.
// No thread yet is not an error.
func (s *Service) MarkRead(ctx context.Context, userID int64, username string) error {
	peer, err := s.resolve(ctx, username)
	if err != nil {
		return err
	}
	thread, err := s.q.GetDMThread(ctx, sqlcgen.GetDMThreadParams{Column1: userID, Column2: peer.ID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get thread: %w", err)
	}
	if err := s.q.MarkDMThreadRead(ctx, sqlcgen.MarkDMThreadReadParams{Viewer: userID, Thread: thread.ID}); err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}
