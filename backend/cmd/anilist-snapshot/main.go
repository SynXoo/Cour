// anilist-snapshot refreshes the committed fixtures (backend/fixtures/*.json)
// from the live AniList API: current + next season charts, the global
// trending page, and the airing schedule for the coming week.
//
// Run rarely and deliberately — it makes ~15 rate-limited requests.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"cour/internal/anilist"
)

func main() {
	out := flag.String("out", "fixtures", "output directory")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	client := anilist.NewClient(log)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := run(ctx, client, log, *out); err != nil {
		log.Error("snapshot failed", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, client *anilist.Client, log *slog.Logger, out string) error {
	now := time.Now()
	byID := map[int]anilist.Media{}

	collect := func(media []anilist.Media) {
		for _, m := range media {
			byID[m.ID] = m
		}
	}

	// Current + next season, every page.
	season, year := anilist.CurrentSeason(now)
	for _, sy := range []struct {
		season string
		year   int
	}{
		{season, year},
		func() struct {
			season string
			year   int
		} {
			s, y := anilist.NextSeason(season, year)
			return struct {
				season string
				year   int
			}{s, y}
		}(),
	} {
		for page := 1; page <= 6; page++ {
			media, hasNext, err := client.SeasonPage(ctx, sy.season, sy.year, page, 50)
			if err != nil {
				return fmt.Errorf("season %s %d: %w", sy.season, sy.year, err)
			}
			collect(media)
			log.Info("fetched season page", "season", sy.season, "year", sy.year, "page", page, "total", len(byID))
			if !hasNext {
				break
			}
		}
	}

	// Global trending: keeps a spread of currently-hot titles from past
	// seasons too (needed for a convincing demo).
	for page := 1; page <= 2; page++ {
		media, hasNext, err := client.TrendingPage(ctx, page, 50)
		if err != nil {
			return fmt.Errorf("trending: %w", err)
		}
		collect(media)
		log.Info("fetched trending page", "page", page, "total", len(byID))
		if !hasNext {
			break
		}
	}

	// Airing schedule for the coming week.
	var entries []anilist.AiringFixture
	from, to := now.Add(-24*time.Hour), now.Add(8*24*time.Hour)
	for page := 1; page <= 24; page++ {
		schedules, hasNext, err := client.AiringPage(ctx, from, to, page)
		if err != nil {
			return fmt.Errorf("airing: %w", err)
		}
		for _, sc := range schedules {
			collect([]anilist.Media{sc.Media})
			entries = append(entries, anilist.AiringFixture{
				AniListID: sc.Media.ID,
				Episode:   sc.Episode,
				AiringAt:  time.Unix(sc.AiringAt, 0).UTC(),
			})
		}
		log.Info("fetched airing page", "page", page, "entries", len(entries))
		if !hasNext {
			break
		}
	}

	media := make([]anilist.Media, 0, len(byID))
	for _, m := range byID {
		media = append(media, m)
	}

	if err := writeJSON(filepath.Join(out, "anime.json"), anilist.Snapshot{
		FetchedAt: now.UTC(),
		Media:     media,
	}); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(out, "airing.json"), anilist.AiringSnapshot{
		FetchedAt: now.UTC(),
		Entries:   entries,
	}); err != nil {
		return err
	}

	log.Info("snapshot written", "media", len(media), "airing_entries", len(entries), "dir", out)
	return nil
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
