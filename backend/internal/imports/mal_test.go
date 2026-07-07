package imports

import (
	"bytes"
	"compress/gzip"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

const sampleMALXML = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>123</user_id>
    <user_name>sakuga_sam</user_name>
  </myinfo>
  <anime>
    <series_animedb_id>1535</series_animedb_id>
    <series_title><![CDATA[Death Note]]></series_title>
    <series_type>TV</series_type>
    <series_episodes>37</series_episodes>
    <my_watched_episodes>37</my_watched_episodes>
    <my_start_date>2010-01-05</my_start_date>
    <my_finish_date>2010-02-01</my_finish_date>
    <my_score>9</my_score>
    <my_status>Completed</my_status>
  </anime>
  <anime>
    <series_animedb_id>38000</series_animedb_id>
    <series_title><![CDATA[Kimetsu no Yaiba]]></series_title>
    <series_type>TV</series_type>
    <series_episodes>26</series_episodes>
    <my_watched_episodes>11</my_watched_episodes>
    <my_start_date>0000-00-00</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_score>0</my_score>
    <my_status>Watching</my_status>
  </anime>
  <anime>
    <series_animedb_id>0</series_animedb_id>
    <series_title><![CDATA[Some Obscure OVA]]></series_title>
    <series_type>OVA</series_type>
    <my_watched_episodes>1</my_watched_episodes>
    <my_score>0</my_score>
    <my_status>6</my_status>
  </anime>
  <anime>
    <series_animedb_id>999</series_animedb_id>
    <series_title><![CDATA[Future Status Show]]></series_title>
    <my_status>Simulcasting</my_status>
  </anime>
</myanimelist>`

func TestParseMAL(t *testing.T) {
	rows, err := ParseMAL(strings.NewReader(sampleMALXML))
	require.NoError(t, err)
	require.Len(t, rows, 3, "unknown-status row is dropped")

	dn := rows[0]
	assert.Equal(t, 1535, dn.MALID)
	assert.Equal(t, "Death Note", dn.Title, "CDATA unwraps")
	assert.Equal(t, "TV", dn.Format)
	assert.Equal(t, 0, dn.Year, "MAL exports carry no year")
	assert.Equal(t, sqlcgen.ListStatusCompleted, dn.Status)
	require.NotNil(t, dn.Score)
	assert.Equal(t, int16(9), *dn.Score)
	assert.Equal(t, int32(37), dn.Progress)
	require.NotNil(t, dn.StartedOn)
	assert.Equal(t, "2010-01-05", *dn.StartedOn)
	require.NotNil(t, dn.FinishedOn)
	assert.Equal(t, "2010-02-01", *dn.FinishedOn)
	assert.Equal(t, MatchReview, dn.Match, "rows start unmatched")

	kny := rows[1]
	assert.Equal(t, sqlcgen.ListStatusWatching, kny.Status)
	assert.Nil(t, kny.Score, "0 = unscored")
	assert.Nil(t, kny.StartedOn, "0000-00-00 is MAL's null")
	assert.Nil(t, kny.FinishedOn)

	ova := rows[2]
	assert.Equal(t, 0, ova.MALID, "id-less row survives on its title")
	assert.Equal(t, "Some Obscure OVA", ova.Title)
	assert.Equal(t, sqlcgen.ListStatusPlanning, ova.Status, "legacy numeric status 6")
}

func TestParseMALGzip(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err := gz.Write([]byte(sampleMALXML))
	require.NoError(t, err)
	require.NoError(t, gz.Close())

	rows, err := ParseMAL(&buf)
	require.NoError(t, err)
	assert.Len(t, rows, 3)
}

func TestParseMALRejectsGarbage(t *testing.T) {
	var badInput *BadInputError

	_, err := ParseMAL(strings.NewReader("this is not xml at all"))
	require.ErrorAs(t, err, &badInput)

	// Valid XML, wrong document.
	_, err = ParseMAL(strings.NewReader(`<?xml version="1.0"?><animelist><anime/></animelist>`))
	require.ErrorAs(t, err, &badInput)

	// Right document, nothing in it.
	_, err = ParseMAL(strings.NewReader(`<?xml version="1.0"?><myanimelist><myinfo/></myanimelist>`))
	require.ErrorAs(t, err, &badInput)

	// Gzip magic bytes, garbage stream.
	_, err = ParseMAL(bytes.NewReader([]byte{0x1f, 0x8b, 0xff, 0xff, 0xff}))
	require.ErrorAs(t, err, &badInput)
}

func TestParseMALEntryDateRoundTrip(t *testing.T) {
	d := "2019-04-06"
	parsed := ParseEntryDate(&d)
	require.NotNil(t, parsed)
	assert.Equal(t, 2019, parsed.Year())

	junk := "yesterday-ish"
	assert.Nil(t, ParseEntryDate(&junk))
	assert.Nil(t, ParseEntryDate(nil))
}
