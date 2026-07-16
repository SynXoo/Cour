package profiles

import "testing"

func TestUpdateInputValidateAccent(t *testing.T) {
	ptr := func(s string) *string { return &s }

	cases := []struct {
		name    string
		accent  *string
		problem bool
	}{
		{"omitted keeps whatever is stored", nil, false},
		{"empty string clears it", ptr(""), false},
		{"lowercase hex", ptr("#aabbcc"), false},
		{"uppercase hex is folded, not rejected", ptr("#AABBCC"), false},
		{"mixed case hex", ptr("#AaBbCc"), false},
		{"missing hash", ptr("aabbcc"), true},
		{"short form is not accepted — the column stores six", ptr("#abc"), true},
		{"too few digits", ptr("#aabbc"), true},
		{"too many digits", ptr("#aabbccd"), true},
		{"non-hex digits", ptr("#gggggg"), true},
		{"css color name", ptr("rebeccapurple"), true},
		{"leading space", ptr(" #aabbcc"), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems := UpdateInput{AccentColor: tc.accent}.Validate()
			_, got := problems["accent_color"]
			if got != tc.problem {
				t.Fatalf("accent %v: problem=%v, want %v (problems=%v)", tc.accent, got, tc.problem, problems)
			}
		})
	}
}

// The column's CHECK is case-sensitive, so anything that passes validation has
// to survive lowercasing into a form the constraint accepts.
func TestAccentPatternMatchesLoweredInput(t *testing.T) {
	for _, in := range []string{"#AABBCC", "#AaBbCc", "#abcdef", "#012345"} {
		lowered := ""
		for _, r := range in {
			if r >= 'A' && r <= 'Z' {
				r += 'a' - 'A'
			}
			lowered += string(r)
		}
		if !accentPattern.MatchString(lowered) {
			t.Fatalf("%q lowercased to %q, which the column would reject", in, lowered)
		}
	}
}
