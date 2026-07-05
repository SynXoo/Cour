package cache

import (
	"context"
	"fmt"
	"time"
)

// Key builders — every cache key in the app is minted here so the namespace
// stays greppable. The :v1 segment allows schema-breaking changes without a
// flush.
func KeyAnime(id int64) string { return fmt.Sprintf("anime:v1:%d", id) }

func KeySeason(year int, season string) string {
	return fmt.Sprintf("season:v1:%d:%s", year, season)
}

// Generation counters: some caches (the schedule) are keyed by arbitrary
// ranges that can't be enumerated for deletion. Instead the key embeds a
// generation number; invalidation is one INCR and stale generations expire
// via TTL.
const GenSchedule = "gen:schedule"

func (c *Cache) BumpGeneration(ctx context.Context, gen string) error {
	if err := c.R.Incr(ctx, gen).Err(); err != nil {
		return fmt.Errorf("bump generation %s: %w", gen, err)
	}
	return nil
}

func (c *Cache) Generation(ctx context.Context, gen string) int64 {
	n, err := c.R.Get(ctx, gen).Int64()
	if err != nil {
		return 0 // missing key or transient error: treat as generation 0
	}
	return n
}

func (c *Cache) KeySchedule(ctx context.Context, from, to time.Time) string {
	return fmt.Sprintf("schedule:v1:g%d:%d:%d", c.Generation(ctx, GenSchedule), from.Unix(), to.Unix())
}
