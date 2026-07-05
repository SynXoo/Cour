package httpapi

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Sousou no Frieren":       "sousou-no-frieren",
		"Re:ZERO -Starting Life-": "re-zero-starting-life",
		"86—EIGHTY-SIX":           "86-eighty-six",
		"ぼっち・ざ・ろっく！":              "title", // non-latin collapses entirely
		"  Spaces   everywhere  ": "spaces-everywhere",
		"UPPER lower 123":         "upper-lower-123",
	}
	for in, want := range cases {
		assert.Equal(t, want, Slugify(in), "input %q", in)
	}

	long := Slugify("a" + string(make([]byte, 0)) + "very " + "long " + "title " + "word " + "repeated " + "many " + "times " + "over " + "and " + "over " + "and " + "over " + "again " + "yes")
	assert.LessOrEqual(t, len(long), 80)
}

func TestCleanDescription(t *testing.T) {
	in := "First line.<br><br>Second &amp; third.<i>italics</i> <a href=\"x\">link</a>"
	got := cleanDescription(&in)
	require.NotNil(t, got)
	assert.Equal(t, "First line.\n\nSecond & third.italics link", *got)

	assert.Nil(t, cleanDescription(nil))
}
