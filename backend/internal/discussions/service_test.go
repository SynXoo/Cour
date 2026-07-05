package discussions

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

func TestParseTimestamp(t *testing.T) {
	cases := map[string]int32{
		"0:00":    0,
		"12:34":   754,
		"1:02:03": 3723,
		" 5:00 ":  300,
		"0:90":    90, // lenient: overflow segments still count
	}
	for in, want := range cases {
		got, err := ParseTimestamp(in)
		require.NoError(t, err, "input %q", in)
		assert.Equal(t, want, got, "input %q", in)
	}

	for _, bad := range []string{"", "12", "1:2:3:4", "ab:cd", "-1:00"} {
		_, err := ParseTimestamp(bad)
		assert.Error(t, err, "input %q", bad)
	}
}

func TestPublicBodyTombstones(t *testing.T) {
	now := sqlcgen.Comment{Body: "hot take"}
	assert.Equal(t, "hot take", PublicBody(now))

	deleted := sqlcgen.Comment{Body: "hot take", DeletedAt: &now.CreatedAt}
	assert.Equal(t, DeletedBody, PublicBody(deleted))
}
