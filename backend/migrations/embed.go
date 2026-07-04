// Package migrations embeds the SQL migration files so binaries are
// self-contained and can migrate on startup.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
