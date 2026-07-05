package moderation

import (
	"os"
	"strings"
)

// ProfanityFilter is the hook content-creating services call before
// accepting user text. Implementations decide policy; callers only get a
// verdict.
type ProfanityFilter interface {
	// Flagged reports whether the text violates the language policy.
	Flagged(text string) bool
}

// NoopFilter accepts everything (the default: Cour moderates via reports,
// not automated censorship).
type NoopFilter struct{}

func (NoopFilter) Flagged(string) bool { return false }

// WordlistFilter is the simplest useful implementation — a lowercase
// substring denylist, intended as the seam where a real service
// (Perspective API, a classifier) would plug in. Enabled via
// PROFANITY_FILTER=wordlist with PROFANITY_WORDS=a,b,c.
type WordlistFilter struct {
	words []string
}

func NewWordlistFilter(words []string) *WordlistFilter {
	cleaned := make([]string, 0, len(words))
	for _, w := range words {
		if w = strings.ToLower(strings.TrimSpace(w)); w != "" {
			cleaned = append(cleaned, w)
		}
	}
	return &WordlistFilter{words: cleaned}
}

func (f *WordlistFilter) Flagged(text string) bool {
	lower := strings.ToLower(text)
	for _, w := range f.words {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

// FilterFromEnv builds the configured filter, or nil when the policy is off
// (PROFANITY_FILTER=wordlist enables it; PROFANITY_WORDS=a,b,c supplies the
// denylist).
func FilterFromEnv() ProfanityFilter {
	if os.Getenv("PROFANITY_FILTER") != "wordlist" {
		return nil
	}
	words := strings.Split(os.Getenv("PROFANITY_WORDS"), ",")
	return NewWordlistFilter(words)
}
