package anilist

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"time"
)

// Snapshot is the on-disk fixture format produced by cmd/anilist-snapshot.
type Snapshot struct {
	FetchedAt time.Time `json:"fetched_at"`
	Media     []Media   `json:"media"`
}

// AiringSnapshot references media by AniList id to avoid duplicating them.
type AiringSnapshot struct {
	FetchedAt time.Time       `json:"fetched_at"`
	Entries   []AiringFixture `json:"entries"`
}

type AiringFixture struct {
	AniListID int       `json:"anilist_id"`
	Episode   int       `json:"episode"`
	AiringAt  time.Time `json:"airing_at"`
}

func LoadSnapshot(fsys fs.FS) (Snapshot, AiringSnapshot, error) {
	var snap Snapshot
	var airing AiringSnapshot

	raw, err := fs.ReadFile(fsys, "anime.json")
	if err != nil {
		return snap, airing, fmt.Errorf("read anime fixtures: %w", err)
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		return snap, airing, fmt.Errorf("decode anime fixtures: %w", err)
	}

	raw, err = fs.ReadFile(fsys, "airing.json")
	if err != nil {
		return snap, airing, fmt.Errorf("read airing fixtures: %w", err)
	}
	if err := json.Unmarshal(raw, &airing); err != nil {
		return snap, airing, fmt.Errorf("decode airing fixtures: %w", err)
	}
	return snap, airing, nil
}

// SeedFromFixtures loads a snapshot into the database through the same upsert
// path the live sync uses.
func (s *Syncer) SeedFromFixtures(ctx context.Context, snap Snapshot, airing AiringSnapshot) (int, error) {
	ids, err := s.UpsertMedia(ctx, snap.Media)
	if err != nil {
		return 0, fmt.Errorf("seed media: %w", err)
	}
	for _, e := range airing.Entries {
		animeID, ok := ids[e.AniListID]
		if !ok {
			continue
		}
		at := e.AiringAt.UTC()
		if err := s.upsertEpisodeAiring(ctx, animeID, e.Episode, at); err != nil {
			return len(ids), err
		}
	}
	return len(ids), nil
}
