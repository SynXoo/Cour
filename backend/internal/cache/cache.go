// Package cache wraps Redis with the small set of patterns the app uses:
// JSON cache-aside values and key invalidation. Rate limiting and the
// trending ZSET talk to the client directly.
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func NewRedis(addr string) *redis.Client {
	return redis.NewClient(&redis.Options{Addr: addr})
}

type Cache struct {
	R *redis.Client
}

func New(r *redis.Client) *Cache { return &Cache{R: r} }

// GetJSON loads key into dest. Returns found=false (not an error) on miss.
func (c *Cache) GetJSON(ctx context.Context, key string, dest any) (bool, error) {
	raw, err := c.R.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return false, nil
		}
		return false, fmt.Errorf("cache get %s: %w", key, err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return false, fmt.Errorf("cache decode %s: %w", key, err)
	}
	return true, nil
}

func (c *Cache) SetJSON(ctx context.Context, key string, v any, ttl time.Duration) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("cache encode %s: %w", key, err)
	}
	if err := c.R.Set(ctx, key, raw, ttl).Err(); err != nil {
		return fmt.Errorf("cache set %s: %w", key, err)
	}
	return nil
}

func (c *Cache) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := c.R.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("cache delete: %w", err)
	}
	return nil
}
