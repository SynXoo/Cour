package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"

	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/auth"
	"cour/internal/discussions"
	"cour/internal/lists"
	"cour/internal/reviews"
	"cour/internal/social"
	"cour/internal/store/sqlcgen"
)

// Demo world: deterministic users with overlapping tastes, spread over the
// trending window, so feeds, trending, and recommendations all demo well.
const (
	demoUserCount = 25
	demoPassword  = "cour-demo-2026"
)

var demoNames = []string{
	"sakuga_sam", "cour_counter", "eyecatch_emi", "isekai_iris", "op_skipper",
	"ed_enjoyer", "manga_reader9", "anilyzer", "keyframe_kai", "binge_beacon",
	"subwatcher", "dub_defender", "seasonal_sue", "backlog_ben", "gacha_gwen",
	"slice_of_leif", "mecha_mia", "shoujo_shane", "seinen_sena", "josei_joy",
	"tsundere_tom", "yandere_yara", "kuudere_kit", "dandere_dan", "senpai_sol",
}

var reviewSnippets = []string{
	"Watched this weekly and the discussion threads made it twice as good. The production holds up under pressure and the writing trusts its audience — nothing is over-explained, and the payoffs are earned. A couple of mid-cour episodes lean on stills, but the direction carries them.",
	"Came in skeptical, left a believer. The first two episodes are table-setting, but from episode three on it finds a rhythm that most shows never manage. Sound design deserves special mention — headphones mandatory. If the finale sticks the landing this is a season highlight.",
	"This is comfort food executed with unreasonable care. Every character gets a moment to be more than their archetype, and the quiet episodes are the best ones. Not every swing connects, and the comedy is hit-or-miss, but I looked forward to it every single week.",
	"An adaptation that understands WHY the source material works instead of just photocopying panels. Pacing is deliberate — some will call it slow — but the atmosphere is the point. The soundtrack does heavy lifting in the back half. Recommended for patient watchers.",
	"Messy, ambitious, occasionally brilliant. The highs (episode 7, you know the one) justify the lows. Animation quality fluctuates and one subplot goes nowhere, but the central relationship is written with rare honesty. I'd rather watch an interesting 7 than a boring 8.",
}

var commentSnippets = []string{
	"That cut at the end — I audibly gasped. Whole cour built to this.",
	"The storyboard this week was unreal. Rewatched the cold open twice.",
	"Okay the OP finally makes sense now. Clever.",
	"Manga readers staying respectfully quiet this week, I see you.",
	"This show understands restraint. The silence hit harder than any line.",
	"Weekly reminder that the sound director is carrying this adaptation.",
	"I was NOT ready. Speechless.",
	"Best episode of the season so far, no contest.",
}

func seedDemo(ctx context.Context, pool *pgxpool.Pool, q *sqlcgen.Queries, log *slog.Logger) error {
	userCount, err := q.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if userCount >= demoUserCount {
		log.Info("demo users already present — skipping demo seed", "users", userCount)
		return nil
	}

	rng := rand.New(rand.NewPCG(42, 7))

	// One shared hash: argon2id is deliberately slow, and these are demo
	// accounts with a printed password anyway.
	hash, err := auth.HashPassword(demoPassword)
	if err != nil {
		return err
	}

	users := make([]sqlcgen.User, 0, len(demoNames))
	for _, name := range demoNames {
		user, err := q.CreateUser(ctx, sqlcgen.CreateUserParams{
			Email:        name + "@cour.demo",
			Username:     name,
			PasswordHash: &hash,
		})
		if err != nil {
			return fmt.Errorf("create demo user %s: %w", name, err)
		}
		users = append(users, user)
	}

	// Popular titles dominate picks (like reality), but everything gets a
	// chance — that spread is what makes hidden gems and recs interesting.
	catalog, err := q.BrowseAnime(ctx, sqlcgen.BrowseAnimeParams{Limit: 150, Offset: 0})
	if err != nil {
		return fmt.Errorf("browse catalog: %w", err)
	}
	if len(catalog) == 0 {
		return fmt.Errorf("catalog empty — fixture seed must run before demo seed")
	}
	pick := func() sqlcgen.Anime {
		// Quadratic bias toward the front (popularity-ordered) of the list.
		f := rng.Float64()
		return catalog[int(f*f*float64(len(catalog)))]
	}

	listSvc := lists.New(pool, log)
	reviewSvc := reviews.New(pool, log)
	discussSvc := discussions.New(pool, log)
	socialSvc := social.New(pool, nil, log)

	statuses := []sqlcgen.ListStatus{
		sqlcgen.ListStatusWatching, sqlcgen.ListStatusWatching, sqlcgen.ListStatusWatching,
		sqlcgen.ListStatusCompleted, sqlcgen.ListStatusCompleted,
		sqlcgen.ListStatusPlanning, sqlcgen.ListStatusPaused, sqlcgen.ListStatusDropped,
	}

	entries, favorites, reviewCount, comments, follows := 0, 0, 0, 0, 0

	for _, user := range users {
		// 8-20 list entries each.
		n := 8 + rng.IntN(13)
		seen := map[int64]bool{}
		for i := 0; i < n; i++ {
			anime := pick()
			if seen[anime.ID] {
				continue
			}
			seen[anime.ID] = true

			status := statuses[rng.IntN(len(statuses))]
			in := lists.UpsertInput{Status: status}
			if status == sqlcgen.ListStatusCompleted || rng.IntN(3) == 0 {
				score := int16(5 + rng.IntN(6)) // 5-10, roughly bell-ish via re-roll
				if score < 7 && rng.IntN(2) == 0 {
					score += 2
				}
				in.Score = &score
			}
			if status == sqlcgen.ListStatusWatching && anime.EpisodesCount != nil && *anime.EpisodesCount > 0 {
				p := rng.Int32N(*anime.EpisodesCount)
				in.Progress = &p
			}
			if _, err := listSvc.Upsert(ctx, user.ID, anime.ID, in); err != nil {
				return fmt.Errorf("demo list entry: %w", err)
			}
			entries++

			// Favorites skew toward high scores.
			if in.Score != nil && *in.Score >= 8 && rng.IntN(2) == 0 {
				if err := listSvc.Favorite(ctx, user.ID, anime.ID); err != nil {
					return fmt.Errorf("demo favorite: %w", err)
				}
				favorites++
			}
		}

		// ~40% of users write one review.
		if rng.IntN(5) < 2 {
			anime := pick()
			score := int16(6 + rng.IntN(5))
			if _, err := reviewSvc.Upsert(ctx, user.ID, anime.ID, reviews.UpsertInput{
				Body:        reviewSnippets[rng.IntN(len(reviewSnippets))],
				Score:       score,
				HasSpoilers: rng.IntN(4) == 0,
			}); err != nil {
				return fmt.Errorf("demo review: %w", err)
			}
			reviewCount++
		}

		// Everyone follows 2-6 others.
		for i, m := 0, 2+rng.IntN(5); i < m; i++ {
			target := users[rng.IntN(len(users))]
			if target.ID == user.ID {
				continue
			}
			if _, err := socialSvc.Follow(ctx, user.ID, target.Username); err != nil {
				return fmt.Errorf("demo follow: %w", err)
			}
			follows++
		}
	}

	// Episode-thread chatter on the five most popular airing titles.
	airing, err := q.ListReleasingAnime(ctx)
	if err != nil {
		return fmt.Errorf("releasing anime: %w", err)
	}
	for i, a := range airing {
		if i >= 5 {
			break
		}
		eps, err := q.ListEpisodes(ctx, a.ID)
		if err != nil || len(eps) == 0 {
			continue
		}
		ec, err := discussSvc.EpisodeThread(ctx, a.ID, eps[0].Number)
		if err != nil {
			continue
		}
		for c, m := 0, 3+rng.IntN(5); c < m; c++ {
			user := users[rng.IntN(len(users))]
			in := discussions.PostInput{Body: commentSnippets[rng.IntN(len(commentSnippets))]}
			if rng.IntN(2) == 0 {
				ts := int32(30 + rng.IntN(1300))
				in.TimestampSeconds = &ts
			}
			if _, err := discussSvc.Post(ctx, ec.Thread.ID, user.ID, in); err != nil {
				return fmt.Errorf("demo comment: %w", err)
			}
			comments++
		}
	}

	// Smear everything across the trending window so decay matters.
	if err := q.SpreadActivityTimestamps(ctx); err != nil {
		return fmt.Errorf("spread activities: %w", err)
	}
	if err := q.SpreadListEntryTimestamps(ctx); err != nil {
		return fmt.Errorf("spread entries: %w", err)
	}

	log.Info("demo world seeded",
		"users", len(users), "entries", entries, "favorites", favorites,
		"reviews", reviewCount, "comments", comments, "follows", follows)
	log.Info("demo login", "email", demoNames[0]+"@cour.demo", "password", demoPassword)
	return nil
}
