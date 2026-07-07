package imports

// MAL export parsing. The official XML export (Settings → "Export my list")
// is the one import path that works for dead accounts and needs no API key.
// Files arrive plain or gzipped; both are handled by sniffing, not by
// trusting the filename.

import (
	"bufio"
	"compress/gzip"
	"encoding/xml"
	"errors"
	"io"
	"strings"
)

// maxDecompressedBytes bounds the XML actually parsed, whatever the upload
// cap was — a tiny gzipped body must not expand without limit.
const maxDecompressedBytes = 64 << 20

type malExport struct {
	XMLName xml.Name   `xml:"myanimelist"`
	Anime   []malAnime `xml:"anime"`
}

type malAnime struct {
	SeriesID   int    `xml:"series_animedb_id"`
	Title      string `xml:"series_title"`
	Type       string `xml:"series_type"`
	Episodes   int    `xml:"series_episodes"`
	Watched    int    `xml:"my_watched_episodes"`
	StartDate  string `xml:"my_start_date"`
	FinishDate string `xml:"my_finish_date"`
	Score      int    `xml:"my_score"`
	Status     string `xml:"my_status"`
}

// ParseMAL reads a MAL XML export (plain or gzip) into unmatched rows.
// Malformed files fail as BadInputError; rows with statuses this side can't
// represent, or with neither an id nor a title, are dropped silently — MAL
// has accumulated two decades of export quirks and one odd row shouldn't
// void the other nine hundred.
func ParseMAL(r io.Reader) ([]Row, error) {
	br := bufio.NewReader(r)
	if magic, err := br.Peek(2); err == nil && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, &BadInputError{Reason: "file looks gzipped but doesn't decompress"}
		}
		defer func() { _ = gz.Close() }()
		return parseMALXML(gz)
	}
	return parseMALXML(br)
}

func parseMALXML(r io.Reader) ([]Row, error) {
	var export malExport
	limited := &limitedReader{r: r, n: maxDecompressedBytes}
	if err := xml.NewDecoder(limited).Decode(&export); err != nil {
		if errors.Is(err, errTooLarge) {
			return nil, &BadInputError{Reason: "export exceeds the size limit"}
		}
		return nil, &BadInputError{Reason: "not a valid MAL XML export"}
	}
	if len(export.Anime) == 0 {
		return nil, &BadInputError{Reason: "no anime entries found in the export"}
	}

	rows := make([]Row, 0, len(export.Anime))
	for _, a := range export.Anime {
		status, ok := ConvertMALStatus(a.Status)
		if !ok {
			continue
		}
		title := strings.TrimSpace(a.Title)
		if a.SeriesID <= 0 && title == "" {
			continue
		}
		rows = append(rows, Row{
			MALID:      max(a.SeriesID, 0),
			Title:      title,
			Format:     strings.TrimSpace(a.Type), // MAL has no premiere year in exports; Year stays 0
			Status:     status,
			Score:      ConvertMALScore(a.Score),
			Progress:   int32(max(a.Watched, 0)),
			StartedOn:  malDate(a.StartDate),
			FinishedOn: malDate(a.FinishDate),
			Match:      MatchReview,
		})
	}
	if len(rows) == 0 {
		return nil, &BadInputError{Reason: "no importable entries found in the export"}
	}
	return rows, nil
}

// malDate keeps a real export date and drops MAL's "0000-00-00" placeholder
// (and anything else that isn't a date).
func malDate(s string) *string {
	s = strings.TrimSpace(s)
	if ParseEntryDate(&s) == nil {
		return nil
	}
	return &s
}

var errTooLarge = errors.New("imports: input exceeds size limit")

// limitedReader is io.LimitedReader with a distinguishable overflow error,
// so "file too big" doesn't masquerade as "file truncated".
type limitedReader struct {
	r io.Reader
	n int64
}

func (l *limitedReader) Read(p []byte) (int, error) {
	if l.n <= 0 {
		return 0, errTooLarge
	}
	if int64(len(p)) > l.n {
		p = p[:l.n]
	}
	n, err := l.r.Read(p)
	l.n -= int64(n)
	return n, err
}
