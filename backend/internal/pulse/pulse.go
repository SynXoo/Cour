// Package pulse computes the signed-in home's "your pulse" block (§M3.8):
// the viewer's activity streak, the badges their history has earned (and
// the next one within reach), replies other people left on their comments,
// and the reactions their comments drew this week. It exists to give a
// returning member something that moved since last night — the incentive
// layer over the tracker.
package pulse

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"
	_ "time/tzdata" // the API image is Alpine-thin; embed the zone database

	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

const (
	repliesLimit = 6
	snippetRunes = 140
)

type Service struct {
	q   *sqlcgen.Queries
	log *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), log: log}
}

// Streak is consecutive active days. "Active" means any activity row —
// a +1, a comment, a list add — so the cheapest possible action keeps it
// alive; the point is showing up, not effort.
type Streak struct {
	Current     int
	Best        int
	ActiveToday bool
	// Week is the last seven days, oldest first; Week[6] is today.
	Week [7]bool
}

type Tier string

const (
	TierBronze Tier = "bronze"
	TierSilver Tier = "silver"
	TierGold   Tier = "gold"
)

type Badge struct {
	ID          string
	Label       string
	Description string
	Tier        Tier
}

// BadgeProgress is an unearned badge with how far along the viewer is.
type BadgeProgress struct {
	Badge
	Progress int
	Target   int
}

type Reply struct {
	CommentID     int64
	ActorUsername string
	ActorAvatar   *string
	Anime         sqlcgen.Anime
	Episode       *int32
	Kind          sqlcgen.ThreadKind
	Snippet       string
	ParentSnippet string
	CreatedAt     time.Time
}

type KudosComment struct {
	CommentID int64
	Anime     sqlcgen.Anime
	Episode   *int32
	Kind      sqlcgen.ThreadKind
	Snippet   string
	Reactions int
}

type Kudos struct {
	ReactionsWeek int
	Top           *KudosComment
}

type Pulse struct {
	Streak    Streak
	Badges    []Badge
	NextBadge *BadgeProgress
	Replies   []Reply
	Kudos     Kudos
}

// counters is everything a badge can be a threshold on.
type counters struct {
	Comments          int
	ShowsDiscussed    int
	Completed         int
	Favorites         int
	Reviews           int
	NightComments     int
	EarlyComments     int
	ReactionsReceived int
	BestStreak        int
}

type badgeDef struct {
	Badge
	Target int
	Metric func(counters) int
}

// The catalog, in display order. Thresholds are deliberately low at the
// bottom (the first badge should land on the first evening) and steep at
// the top. Adding one is appending here — the IDs are what the client keys
// on, so never rename an existing one.
var catalog = []badgeDef{
	{Badge{"first_word", "First word", "Posted your first comment", TierBronze}, 1, func(c counters) int { return c.Comments }},
	{Badge{"regular", "Regular", "10 comments in the rooms", TierSilver}, 10, func(c counters) int { return c.Comments }},
	{Badge{"voice", "Voice of the room", "50 comments — people know your handle", TierGold}, 50, func(c counters) int { return c.Comments }},
	{Badge{"three_nights", "Three nights", "Active three days in a row", TierBronze}, 3, func(c counters) int { return c.BestStreak }},
	{Badge{"seven_nights", "Seven nights", "A full week without missing a day", TierSilver}, 7, func(c counters) int { return c.BestStreak }},
	{Badge{"thirty_nights", "Thirty nights", "A month-long streak", TierGold}, 30, func(c counters) int { return c.BestStreak }},
	{Badge{"finisher", "Finisher", "Completed 5 shows", TierBronze}, 5, func(c counters) int { return c.Completed }},
	{Badge{"marathoner", "Marathoner", "Completed 25 shows", TierSilver}, 25, func(c counters) int { return c.Completed }},
	{Badge{"first_in", "First in the room", "3 comments within an hour of an episode airing", TierSilver}, 3, func(c counters) int { return c.EarlyComments }},
	{Badge{"night_owl", "Night owl", "3 comments after midnight", TierBronze}, 3, func(c counters) int { return c.NightComments }},
	{Badge{"crowd_pleaser", "Crowd pleaser", "Your comments drew 10 reactions", TierSilver}, 10, func(c counters) int { return c.ReactionsReceived }},
	{Badge{"curator", "Curator", "5 favorites picked", TierBronze}, 5, func(c counters) int { return c.Favorites }},
	{Badge{"critic", "Critic", "Wrote a review", TierBronze}, 1, func(c counters) int { return c.Reviews }},
	{Badge{"omnivore", "Omnivore", "Talked in the rooms of 10 different shows", TierSilver}, 10, func(c counters) int { return c.ShowsDiscussed }},
}

// day truncates to a calendar date in UTC, so two dates compare by value.
func day(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// computeStreak folds a set of active dates into the streak view. `today`
// is the viewer's local date. The current streak survives a day that is
// not over yet: if yesterday was active and today isn't (so far), the run
// still counts — the home is exactly where you'd go to extend it.
func computeStreak(active []time.Time, today time.Time) Streak {
	set := make(map[time.Time]bool, len(active))
	for _, d := range active {
		set[day(d)] = true
	}
	today = day(today)

	var s Streak
	s.ActiveToday = set[today]
	start := today
	if !s.ActiveToday {
		start = today.AddDate(0, 0, -1)
	}
	for d := start; set[d]; d = d.AddDate(0, 0, -1) {
		s.Current++
	}

	// Best: walk the sorted unique dates and count runs.
	dates := make([]time.Time, 0, len(set))
	for d := range set {
		dates = append(dates, d)
	}
	sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
	run := 0
	for i, d := range dates {
		if i > 0 && d.Equal(dates[i-1].AddDate(0, 0, 1)) {
			run++
		} else {
			run = 1
		}
		if run > s.Best {
			s.Best = run
		}
	}
	if s.Current > s.Best {
		s.Best = s.Current
	}

	for i := 0; i < 7; i++ {
		s.Week[i] = set[today.AddDate(0, 0, i-6)]
	}
	return s
}

// evaluateBadges splits the catalog into earned badges and the single best
// next target (the unearned badge the viewer is proportionally closest to,
// ties to the cheaper one — the nudge should feel reachable).
func evaluateBadges(c counters) ([]Badge, *BadgeProgress) {
	earned := make([]Badge, 0, len(catalog))
	var next *BadgeProgress
	var nextRatio float64 = -1
	for _, def := range catalog {
		v := def.Metric(c)
		if v >= def.Target {
			earned = append(earned, def.Badge)
			continue
		}
		ratio := float64(v) / float64(def.Target)
		if ratio > nextRatio || (ratio == nextRatio && next != nil && def.Target < next.Target) {
			nextRatio = ratio
			next = &BadgeProgress{Badge: def.Badge, Progress: v, Target: def.Target}
		}
	}
	return earned, next
}

func snippet(body string) string {
	r := []rune(body)
	if len(r) <= snippetRunes {
		return body
	}
	return string(r[:snippetRunes-1]) + "…"
}

// Pulse assembles the block for one viewer. tz is an IANA zone name; an
// unknown zone falls back to UTC rather than failing the whole home.
func (s *Service) Pulse(ctx context.Context, userID int64, tz string, now time.Time) (Pulse, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil || tz == "" {
		loc = time.UTC
		tz = "UTC"
	}

	days, err := s.q.UserActiveDays(ctx, sqlcgen.UserActiveDaysParams{Tz: tz, UserID: userID})
	if err != nil {
		return Pulse{}, fmt.Errorf("active days: %w", err)
	}
	streak := computeStreak(days, now.In(loc))

	counts, err := s.q.UserBadgeCounts(ctx, sqlcgen.UserBadgeCountsParams{UserID: userID, Tz: tz})
	if err != nil {
		return Pulse{}, fmt.Errorf("badge counts: %w", err)
	}
	earned, next := evaluateBadges(counters{
		Comments:          int(counts.Comments),
		ShowsDiscussed:    int(counts.ShowsDiscussed),
		Completed:         int(counts.Completed),
		Favorites:         int(counts.Favorites),
		Reviews:           int(counts.Reviews),
		NightComments:     int(counts.NightComments),
		EarlyComments:     int(counts.EarlyComments),
		ReactionsReceived: int(counts.ReactionsReceived),
		BestStreak:        streak.Best,
	})

	replyRows, err := s.q.RepliesToUser(ctx, sqlcgen.RepliesToUserParams{UserID: userID, Lim: repliesLimit})
	if err != nil {
		return Pulse{}, fmt.Errorf("replies: %w", err)
	}
	replies := make([]Reply, len(replyRows))
	for i, r := range replyRows {
		replies[i] = Reply{
			CommentID:     r.ID,
			ActorUsername: r.ActorUsername,
			ActorAvatar:   r.ActorAvatar,
			Anime:         r.Anime,
			Episode:       r.EpisodeNumber,
			Kind:          r.ThreadKind,
			Snippet:       snippet(r.Body),
			ParentSnippet: snippet(r.ParentBody),
			CreatedAt:     r.CreatedAt,
		}
	}

	topRows, err := s.q.UserTopReactedComments(ctx, userID)
	if err != nil {
		return Pulse{}, fmt.Errorf("kudos: %w", err)
	}
	kudos := Kudos{ReactionsWeek: int(counts.ReactionsWeek)}
	if len(topRows) > 0 {
		t := topRows[0]
		kudos.Top = &KudosComment{
			CommentID: t.ID,
			Anime:     t.Anime,
			Episode:   t.EpisodeNumber,
			Kind:      t.ThreadKind,
			Snippet:   snippet(t.Body),
			Reactions: int(t.Reactions),
		}
	}

	return Pulse{Streak: streak, Badges: earned, NextBadge: next, Replies: replies, Kudos: kudos}, nil
}
