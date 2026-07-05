// Package fixtures embeds a committed AniList snapshot so the app can be
// seeded and demoed with zero network access. Refresh with:
//
//	go run ./cmd/anilist-snapshot
package fixtures

import "embed"

//go:embed *.json
var FS embed.FS
