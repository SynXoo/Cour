package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/discussions"
	"cour/internal/lists"
	"cour/internal/social"
	"cour/internal/store/sqlcgen"
)

// Demo texture for the social layer (docs/PHASE_2.md §M3.9). Runs as its own
// idempotent pass — gated on `friendships` being empty — so an existing demo
// database picks it up on the next `seed` without a reset. Notifications are
// inserted directly (the seeder has no asynq worker); the rows are exactly
// what the notify handlers would have written.

var requestNotes = []string{
	"We keep landing in the same episode threads — friends?",
	"Your Frieren review convinced me to start it. Add me!",
}

var recommendationNotes = []string{
	"The sakuga in episode 7 alone is worth it. Trust me on this one.",
	"Quiet, patient, devastating. Exactly your kind of show.",
}

var dmScripts = [][]string{
	{
		"did you see tonight's episode yet?",
		"just finished. that last cut… I need a minute",
		"RIGHT? the storyboard on that whole sequence was unreal",
		"rewatching the cold open now. thread's on fire",
	},
	{
		"ok I finally started the one you recommended",
		"and??",
		"three episodes in and I get it now. the silence in ep 2 hit hard",
		"wait until 7. don't read anything.",
	},
}

func seedFriends(ctx context.Context, pool *pgxpool.Pool, q *sqlcgen.Queries, log *slog.Logger) error {
	existing, err := q.CountFriendships(ctx)
	if err != nil {
		return fmt.Errorf("count friendships: %w", err)
	}
	if existing > 0 {
		log.Info("friendships already present — skipping social seed", "friendships", existing)
		return nil
	}

	users := make([]sqlcgen.User, 0, len(demoNames))
	for _, name := range demoNames {
		user, err := q.GetUserByUsername(ctx, name)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Info("demo users missing — skipping social seed", "missing", name)
				return nil
			}
			return fmt.Errorf("get demo user %s: %w", name, err)
		}
		users = append(users, user)
	}
	sam := users[0]

	rng := rand.New(rand.NewPCG(43, 11))
	socialSvc := social.New(pool, nil, log)
	listSvc := lists.New(pool, log)
	discussSvc := discussions.New(pool, log)

	// Three people stay out of sakuga_sam's random friendships so their
	// pending requests survive the pass: two incoming, one outgoing.
	incomingFrom := []sqlcgen.User{users[7], users[12]}
	outgoingTo := users[19]
	reserved := map[int64]bool{users[7].ID: true, users[12].ID: true, users[19].ID: true}

	befriend := func(a, b sqlcgen.User) error {
		if _, err := socialSvc.Befriend(ctx, a.ID, b.Username, ""); err != nil {
			return err
		}
		_, err := socialSvc.Befriend(ctx, b.ID, a.Username, "")
		return err
	}

	friendships := 0
	for _, user := range users {
		for i, m := 0, 2+rng.IntN(4); i < m; i++ {
			target := users[rng.IntN(len(users))]
			if target.ID == user.ID {
				continue
			}
			if (user.ID == sam.ID && reserved[target.ID]) || (target.ID == sam.ID && reserved[user.ID]) {
				continue
			}
			if err := befriend(user, target); err != nil {
				return fmt.Errorf("demo friendship: %w", err)
			}
			friendships++
		}
	}

	// Pending requests around sakuga_sam, with the notifications they raise.
	for i, from := range incomingFrom {
		note := requestNotes[i%len(requestNotes)]
		if _, err := socialSvc.Befriend(ctx, from.ID, sam.Username, note); err != nil {
			return fmt.Errorf("demo request: %w", err)
		}
		payload, _ := json.Marshal(map[string]any{"note": note})
		if err := q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
			UserID: sam.ID, Type: sqlcgen.NotificationTypeFriendRequest, ActorID: &from.ID, Payload: payload,
		}); err != nil {
			return fmt.Errorf("demo request notification: %w", err)
		}
	}
	if _, err := socialSvc.Befriend(ctx, sam.ID, outgoingTo.Username, "Loved your take on the finale."); err != nil {
		return fmt.Errorf("demo outgoing request: %w", err)
	}

	friends, err := q.ListFriends(ctx, sqlcgen.ListFriendsParams{UserA: sam.ID, Limit: 10})
	if err != nil {
		return fmt.Errorf("sam's friends: %w", err)
	}
	if len(friends) < 2 {
		log.Warn("social seed: sakuga_sam has fewer than two friends; skipping recs and DMs")
		return nil
	}

	// Something airing on sam's watching list, part-way through, so the
	// episode list has a "you are here" and friends can sit on nearby rows.
	airing, err := q.ListReleasingAnime(ctx)
	if err != nil {
		return fmt.Errorf("releasing anime: %w", err)
	}
	var currentID int64
	for _, a := range airing {
		if eps, err := q.ListEpisodes(ctx, a.ID); err == nil && len(eps) >= 4 {
			currentID = a.ID
			break
		}
	}
	if currentID != 0 {
		progress := int32(3)
		if _, err := listSvc.Upsert(ctx, sam.ID, currentID, lists.UpsertInput{
			Status: sqlcgen.ListStatusWatching, Progress: &progress,
		}); err != nil {
			return fmt.Errorf("sam's airing entry: %w", err)
		}
		// Two friends on the same show, one ahead and one behind.
		for i, f := range friends[:2] {
			p := int32(2 + i*2) // 2 and 4
			if _, err := listSvc.Upsert(ctx, f.ID, currentID, lists.UpsertInput{
				Status: sqlcgen.ListStatusWatching, Progress: &p,
			}); err != nil {
				return fmt.Errorf("friend's airing entry: %w", err)
			}
		}
	}

	// Recommendations to sam for shows not on their list.
	mine, err := q.ListEntryAnimeIDs(ctx, sam.ID)
	if err != nil {
		return fmt.Errorf("sam's list: %w", err)
	}
	onList := map[int64]bool{}
	for _, id := range mine {
		onList[id] = true
	}
	catalog, err := q.BrowseAnime(ctx, sqlcgen.BrowseAnimeParams{Limit: 60, Offset: 0})
	if err != nil {
		return fmt.Errorf("browse catalog: %w", err)
	}
	recs := 0
	for _, a := range catalog {
		if recs == 2 || onList[a.ID] {
			continue
		}
		from := friends[recs]
		note := recommendationNotes[recs]
		if err := socialSvc.Recommend(ctx, from.ID, a.ID, sam.Username, note); err != nil {
			return fmt.Errorf("demo recommendation: %w", err)
		}
		payload, _ := json.Marshal(map[string]any{"note": note})
		if err := q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
			UserID: sam.ID, Type: sqlcgen.NotificationTypeRecommendation,
			ActorID: &from.ID, AnimeID: &a.ID, Payload: payload,
		}); err != nil {
			return fmt.Errorf("demo recommendation notification: %w", err)
		}
		recs++
	}

	// Two conversations, sam opening each; the friend gets the last word so
	// sam has something unread.
	messages := 0
	for i, script := range dmScripts {
		friend := friends[i]
		for j, line := range script {
			senderID, peerName := sam.ID, friend.Username
			if j%2 == 1 {
				senderID, peerName = friend.ID, sam.Username
			}
			if _, err := socialSvc.Send(ctx, senderID, peerName, line); err != nil {
				return fmt.Errorf("demo message: %w", err)
			}
			messages++
		}
	}

	// A friend mentions sam in a live episode thread.
	if currentID != 0 {
		if eps, err := q.ListEpisodes(ctx, currentID); err == nil && len(eps) > 0 {
			if ec, err := discussSvc.EpisodeThread(ctx, currentID, eps[0].Number); err == nil {
				from := friends[1]
				comment, err := discussSvc.Post(ctx, ec.Thread.ID, from.ID, discussions.PostInput{
					Body: "@" + sam.Username + " this is the cut you were talking about, right? Unreal.",
				})
				if err != nil {
					return fmt.Errorf("demo mention: %w", err)
				}
				payload, _ := json.Marshal(map[string]any{
					"thread_id": ec.Thread.ID, "kind": "episode", "episode": eps[0].Number,
				})
				if err := q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
					UserID: sam.ID, Type: sqlcgen.NotificationTypeMention,
					ActorID: &from.ID, AnimeID: &currentID, RefID: &comment.ID, Payload: payload,
				}); err != nil {
					return fmt.Errorf("demo mention notification: %w", err)
				}
			}
		}
	}

	log.Info("social world seeded",
		"friendships", friendships, "pending_requests", len(incomingFrom)+1,
		"recommendations", recs, "messages", messages)
	return nil
}
