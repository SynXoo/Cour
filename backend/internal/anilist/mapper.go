package anilist

import (
	"encoding/json"
	"fmt"
	"time"

	"cour/internal/store/sqlcgen"
)

// dbTag / dbStudio are the JSONB shapes stored on the anime row.
type dbTag struct {
	Name string `json:"name"`
	Rank int    `json:"rank"`
}

type dbStudio struct {
	Name   string `json:"name"`
	IsMain bool   `json:"is_main"`
}

var (
	validFormats = map[string]sqlcgen.AnimeFormat{
		"TV": sqlcgen.AnimeFormatTV, "TV_SHORT": sqlcgen.AnimeFormatTVSHORT,
		"MOVIE": sqlcgen.AnimeFormatMOVIE, "SPECIAL": sqlcgen.AnimeFormatSPECIAL,
		"OVA": sqlcgen.AnimeFormatOVA, "ONA": sqlcgen.AnimeFormatONA,
		"MUSIC": sqlcgen.AnimeFormatMUSIC,
	}
	validStatuses = map[string]sqlcgen.AnimeStatus{
		"FINISHED": sqlcgen.AnimeStatusFINISHED, "RELEASING": sqlcgen.AnimeStatusRELEASING,
		"NOT_YET_RELEASED": sqlcgen.AnimeStatusNOTYETRELEASED,
		"CANCELLED":        sqlcgen.AnimeStatusCANCELLED, "HIATUS": sqlcgen.AnimeStatusHIATUS,
	}
	validSeasons = map[string]sqlcgen.AnimeSeason{
		"WINTER": sqlcgen.AnimeSeasonWINTER, "SPRING": sqlcgen.AnimeSeasonSPRING,
		"SUMMER": sqlcgen.AnimeSeasonSUMMER, "FALL": sqlcgen.AnimeSeasonFALL,
	}
)

// MapMedia converts an AniList Media into upsert params. Unknown enum values
// (AniList occasionally adds formats) degrade to NULL rather than failing the
// whole sync page.
func MapMedia(m Media) (sqlcgen.UpsertAnimeParams, error) {
	if m.ID <= 0 {
		return sqlcgen.UpsertAnimeParams{}, fmt.Errorf("media has no id")
	}
	if m.Title.Romaji == "" {
		return sqlcgen.UpsertAnimeParams{}, fmt.Errorf("media %d has no romaji title", m.ID)
	}

	tags := make([]dbTag, 0, len(m.Tags))
	for _, t := range m.Tags {
		tags = append(tags, dbTag(t))
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return sqlcgen.UpsertAnimeParams{}, fmt.Errorf("media %d: marshal tags: %w", m.ID, err)
	}

	studios := make([]dbStudio, 0, len(m.Studios.Edges))
	for _, e := range m.Studios.Edges {
		studios = append(studios, dbStudio{Name: e.Node.Name, IsMain: e.IsMain})
	}
	studiosJSON, err := json.Marshal(studios)
	if err != nil {
		return sqlcgen.UpsertAnimeParams{}, fmt.Errorf("media %d: marshal studios: %w", m.ID, err)
	}

	p := sqlcgen.UpsertAnimeParams{
		AnilistID:       int32(m.ID),
		MalID:           toInt32(m.IDMal),
		TitleRomaji:     m.Title.Romaji,
		TitleEnglish:    m.Title.English,
		TitleNative:     m.Title.Native,
		Synonyms:        orEmpty(m.Synonyms),
		Description:     m.Description,
		Status:          sqlcgen.AnimeStatusNOTYETRELEASED,
		SeasonYear:      toInt32(m.SeasonYear),
		EpisodesCount:   toInt32(m.Episodes),
		DurationMin:     toInt32(m.Duration),
		Genres:          orEmpty(m.Genres),
		Tags:            tagsJSON,
		Studios:         studiosJSON,
		CoverImage:      m.CoverImage.ExtraLarge,
		CoverColor:      m.CoverImage.Color,
		BannerImage:     m.BannerImage,
		AverageScore:    toInt32(m.AverageScore),
		Popularity:      int32(m.Popularity),
		AnilistTrending: int32(m.Trending),
		IsAdult:         m.IsAdult,
	}

	if m.Format != nil {
		if f, ok := validFormats[*m.Format]; ok {
			p.Format = &f
		}
	}
	if m.Status != nil {
		if s, ok := validStatuses[*m.Status]; ok {
			p.Status = s
		}
	}
	if m.Season != nil {
		if s, ok := validSeasons[*m.Season]; ok {
			p.Season = &s
		}
	}
	if m.NextAiring != nil {
		at := time.Unix(m.NextAiring.AiringAt, 0).UTC()
		ep := int32(m.NextAiring.Episode)
		p.NextAiringAt = &at
		p.NextAiringEpisode = &ep
	}
	return p, nil
}

func toInt32(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}

func orEmpty(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}
