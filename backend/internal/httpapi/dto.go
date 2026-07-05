package httpapi

import (
	"encoding/json"
	"html"
	"regexp"
	"strings"

	"cour/internal/catalog"
	"cour/internal/httpapi/apigen"
	"cour/internal/store/sqlcgen"
)

// ── DTO mapping: sqlc rows → OpenAPI models ───────────────────────────────

func toSummary(a sqlcgen.Anime) apigen.AnimeSummary {
	return apigen.AnimeSummary{
		Id:                a.ID,
		Slug:              Slugify(a.TitleRomaji),
		Title:             a.TitleRomaji,
		TitleEnglish:      a.TitleEnglish,
		CoverImage:        a.CoverImage,
		CoverColor:        a.CoverColor,
		Format:            (*apigen.Format)(a.Format),
		Status:            apigen.AiringStatus(a.Status),
		Season:            (*apigen.Season)(a.Season),
		SeasonYear:        toInt(a.SeasonYear),
		EpisodesCount:     toInt(a.EpisodesCount),
		AverageScore:      toInt(a.AverageScore),
		Popularity:        int(a.Popularity),
		Genres:            a.Genres,
		NextAiringAt:      a.NextAiringAt,
		NextAiringEpisode: toInt(a.NextAiringEpisode),
	}
}

func toSummaries(list []sqlcgen.Anime) []apigen.AnimeSummary {
	out := make([]apigen.AnimeSummary, len(list))
	for i, a := range list {
		out[i] = toSummary(a)
	}
	return out
}

func toDetail(d catalog.Detail) apigen.AnimeDetail {
	a := d.Anime
	s := toSummary(a)

	episodes := make([]apigen.Episode, len(d.Episodes))
	for i, e := range d.Episodes {
		episodes[i] = apigen.Episode{
			Number:   int(e.Number),
			Title:    e.Title,
			AiringAt: e.AiringAt,
		}
	}

	return apigen.AnimeDetail{
		Id:                s.Id,
		Slug:              s.Slug,
		Title:             s.Title,
		TitleEnglish:      s.TitleEnglish,
		CoverImage:        s.CoverImage,
		CoverColor:        s.CoverColor,
		Format:            s.Format,
		Status:            s.Status,
		Season:            s.Season,
		SeasonYear:        s.SeasonYear,
		EpisodesCount:     s.EpisodesCount,
		AverageScore:      s.AverageScore,
		Popularity:        s.Popularity,
		Genres:            s.Genres,
		NextAiringAt:      s.NextAiringAt,
		NextAiringEpisode: s.NextAiringEpisode,

		AnilistId:   int(a.AnilistID),
		TitleNative: a.TitleNative,
		Synonyms:    a.Synonyms,
		Description: cleanDescription(a.Description),
		BannerImage: a.BannerImage,
		DurationMin: toInt(a.DurationMin),
		Tags:        decodeTags(a.Tags),
		Studios:     decodeStudios(a.Studios),
		Episodes:    episodes,
		SyncedAt:    a.SyncedAt,
	}
}

func toInt(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

// decodeTags/decodeStudios unpack the JSONB columns. Corrupt payloads yield
// empty slices — the row is still perfectly renderable.
func decodeTags(raw []byte) []apigen.Tag {
	var tags []apigen.Tag
	if err := json.Unmarshal(raw, &tags); err != nil || tags == nil {
		return []apigen.Tag{}
	}
	return tags
}

func decodeStudios(raw []byte) []apigen.Studio {
	var studios []apigen.Studio
	if err := json.Unmarshal(raw, &studios); err != nil || studios == nil {
		return []apigen.Studio{}
	}
	return studios
}

// ── Text helpers ───────────────────────────────────────────────────────────

var (
	slugStrip    = regexp.MustCompile(`[^a-z0-9]+`)
	brTag        = regexp.MustCompile(`(?i)<br\s*/?>`)
	anyTag       = regexp.MustCompile(`<[^>]*>`)
	manyNewlines = regexp.MustCompile(`\n{3,}`)
)

// Slugify derives the cosmetic URL segment for a title. Lossy by design —
// routes resolve by id, the slug is for humans and search engines.
func Slugify(title string) string {
	s := slugStrip.ReplaceAllString(strings.ToLower(title), "-")
	s = strings.Trim(s, "-")
	if len(s) > 80 {
		s = strings.Trim(s[:80], "-")
	}
	if s == "" {
		return "title"
	}
	return s
}

// cleanDescription converts AniList's HTML-ish description markup to plain
// text with newlines. The API never returns markup, so the frontend never
// has to sanitize.
func cleanDescription(desc *string) *string {
	if desc == nil {
		return nil
	}
	s := brTag.ReplaceAllString(*desc, "\n")
	s = anyTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = manyNewlines.ReplaceAllString(s, "\n\n")
	s = strings.TrimSpace(s)
	return &s
}
