package discussions

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseMentions(t *testing.T) {
	cases := map[string][]string{
		"":                                nil,
		"no mentions here":                nil,
		"@sakuga_sam that cut!":           {"sakuga_sam"},
		"cc @Sakuga_Sam and @sakuga_sam":  {"sakuga_sam"}, // case-folded, deduped
		"hey @ab":                         nil,            // too short for a username
		"mail me at sam@cour.demo":        nil,            // not a word-start @
		"@@double":                        nil,            // the rule is one @
		"(@kai) and [@mia], @sol.":        {"kai", "mia", "sol"},
		"@a1 @b2 @c3 @d4 @e5 @f6 @g7 wow": nil, // two-char handles never match
		"@one_1 @two_2 @three3 @four4 @five5 @six6": {"one_1", "two_2", "three3", "four4", "five5"}, // capped at five
	}
	for in, want := range cases {
		assert.Equal(t, want, ParseMentions(in), "input %q", in)
	}
}
