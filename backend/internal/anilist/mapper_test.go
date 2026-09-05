package anilist

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

func strp(s string) *string { return &s }
func intp(n int) *int       { return &n }

func TestMapMediaFull(t *testing.T) {
	m := Media{
		ID:          154587,
		IDMal:       intp(52991),
		Title:       Title{Romaji: "Sousou no Frieren", English: strp("Frieren"), Native: strp("葬送のフリーレン")},
		Synonyms:    []string{"Frieren at the Funeral"},
		Description: strp("An elf outlives her party."),
		Format:      strp("TV"),
		Status:      strp("FINISHED"),
		Season:      strp("FALL"),
		SeasonYear:  intp(2023),
		Episodes:    intp(28),
		Duration:    intp(24),
		Genres:      []string{"Adventure", "Fantasy"},
		Tags:        []Tag{{Name: "Elf", Rank: 90}},
		Studios: Studios{Edges: []StudioEdge{
			{IsMain: true, Node: struct {
				Name string `json:"name"`
			}{Name: "Madhouse"}},
		}},
		CoverImage:   Cover{ExtraLarge: strp("https://img/cover.jpg"), Color: strp("#bbf1a1")},
		AverageScore: intp(91),
		Popularity:   450000,
		Trending:     12,
		NextAiring:   &Airing{AiringAt: 1780000000, Episode: 29},
	}

	p, err := MapMedia(m)
	require.NoError(t, err)

	assert.EqualValues(t, 154587, p.AnilistID)
	assert.EqualValues(t, 52991, *p.MalID)
	assert.Equal(t, "Sousou no Frieren", p.TitleRomaji)
	assert.Equal(t, "Frieren", *p.TitleEnglish)
	assert.Equal(t, sqlcgen.AnimeFormatTV, *p.Format)
	assert.Equal(t, sqlcgen.AnimeStatusFINISHED, p.Status)
	assert.Equal(t, sqlcgen.AnimeSeasonFALL, *p.Season)
	assert.EqualValues(t, 28, *p.EpisodesCount)
	assert.EqualValues(t, 91, *p.AverageScore)
	assert.EqualValues(t, 450000, p.Popularity)
	assert.Equal(t, time.Unix(1780000000, 0).UTC(), *p.NextAiringAt)
	assert.EqualValues(t, 29, *p.NextAiringEpisode)

	var tags []dbTag
	require.NoError(t, json.Unmarshal(p.Tags, &tags))
	assert.Equal(t, []dbTag{{Name: "Elf", Rank: 90}}, tags)

	var studios []dbStudio
	require.NoError(t, json.Unmarshal(p.Studios, &studios))
	assert.Equal(t, []dbStudio{{Name: "Madhouse", IsMain: true}}, studios)
}

func TestMapMediaUnknownEnumsDegradeToNull(t *testing.T) {
	m := Media{
		ID:     1,
		Title:  Title{Romaji: "X"},
		Format: strp("HOLOGRAM"), // future AniList addition
		Status: strp("UNKNOWN_STATUS"),
		Season: strp("MONSOON"),
	}
	p, err := MapMedia(m)
	require.NoError(t, err)
	assert.Nil(t, p.Format)
	assert.Nil(t, p.Season)
	assert.Equal(t, sqlcgen.AnimeStatusNOTYETRELEASED, p.Status, "unknown status falls back to default")
}

func TestMapMediaRejectsBrokenRecords(t *testing.T) {
	_, err := MapMedia(Media{ID: 0, Title: Title{Romaji: "No ID"}})
	assert.Error(t, err)

	_, err = MapMedia(Media{ID: 5})
	assert.Error(t, err, "missing romaji title")
}

func TestMapMediaNilSlicesBecomeEmpty(t *testing.T) {
	p, err := MapMedia(Media{ID: 2, Title: Title{Romaji: "Y"}})
	require.NoError(t, err)
	assert.Nil(t, p.MalID, "absent idMal maps to NULL, not 0")
	assert.NotNil(t, p.Synonyms)
	assert.NotNil(t, p.Genres)
	assert.JSONEq(t, "[]", string(p.Tags))
	assert.JSONEq(t, "[]", string(p.Studios))
}

func TestSeasonMath(t *testing.T) {
	s, y := CurrentSeason(time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC))
	assert.Equal(t, "SUMMER", s)
	assert.Equal(t, 2026, y)

	s, y = NextSeason("FALL", 2026)
	assert.Equal(t, "WINTER", s)
	assert.Equal(t, 2027, y)
}

func TestKnownEpisodeCount(t *testing.T) {
	ep := func(n int) *int { return &n }
	cases := []struct {
		name string
		m    Media
		want int
	}{
		{"announced total wins", Media{Episodes: ep(24), NextAiring: &Airing{Episode: 13}}, 24},
		{"open-ended run falls back to next airing", Media{NextAiring: &Airing{Episode: 1177}}, 1176},
		{"nothing known", Media{}, 0},
		{"zero total is not a total", Media{Episodes: ep(0)}, 0},
		{"first episode not yet aired", Media{NextAiring: &Airing{Episode: 1}}, 0},
		{"absurd upstream number is capped", Media{Episodes: ep(1 << 20)}, maxEpisodeStubs},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := knownEpisodeCount(c.m); got != c.want {
				t.Fatalf("knownEpisodeCount = %d, want %d", got, c.want)
			}
		})
	}
}
