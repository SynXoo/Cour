package discussions

import (
	"context"
	"regexp"
	"strings"

	"cour/internal/store/sqlcgen"
)

// mentionRe matches @username tokens (the users table's own username rule:
// 3–20 of [A-Za-z0-9_]) that start a word — so "mail@host.com" and
// "@@nope" don't count.
var mentionRe = regexp.MustCompile(`(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})\b`)

// maxMentions caps how many people one comment can ping.
const maxMentions = 5

// ParseMentions returns the distinct usernames a body mentions, lowercased,
// in order of first appearance, at most maxMentions.
func ParseMentions(body string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(body, -1) {
		name := strings.ToLower(m[1])
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
		if len(out) == maxMentions {
			break
		}
	}
	return out
}

// mentionedUserIDs resolves a comment's mentions to user ids, dropping the
// author (no self-pings) and the parent's author (they already get a reply
// notification). Lookup failures are logged, never fatal: a mention is a
// courtesy, the comment is already posted.
func (s *Service) mentionedUserIDs(ctx context.Context, comment sqlcgen.Comment, parentAuthor *int64) []int64 {
	names := ParseMentions(comment.Body)
	if len(names) == 0 {
		return nil
	}
	rows, err := s.q.GetUsersByUsernames(ctx, names)
	if err != nil {
		s.log.Warn("discussions: resolve mentions", "comment", comment.ID, "err", err)
		return nil
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row.ID == comment.UserID || (parentAuthor != nil && row.ID == *parentAuthor) {
			continue
		}
		ids = append(ids, row.ID)
	}
	return ids
}
