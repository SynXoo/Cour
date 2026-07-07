//go:build integration

package integration

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sseEvent is one parsed Server-Sent Event: its name and raw JSON data line.
type sseEvent struct {
	name string
	data []byte
}

// sseStream reads an event stream off a live connection in the background.
type sseStream struct {
	t      *testing.T
	cancel context.CancelFunc
	events chan sseEvent
}

// openSSE connects to an event-stream endpoint and starts parsing it. The
// caller must call close() to tear the connection down.
func openSSE(t *testing.T, path string) *sseStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, testServer.URL+path, nil)
	require.NoError(t, err)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req) //nolint:bodyclose // read() owns the body and closes it when the stream ends (on cancel)
	if err != nil {
		cancel()
		t.Fatalf("open SSE: %v", err)
	}
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "text/event-stream" {
		ct := resp.Header.Get("Content-Type")
		_ = resp.Body.Close()
		cancel()
		t.Fatalf("open SSE: status %d, content-type %q", resp.StatusCode, ct)
	}

	s := &sseStream{t: t, cancel: cancel, events: make(chan sseEvent, 64)}
	go s.read(resp.Body)
	return s
}

// read parses the SSE framing (event:/data: lines, blank-line boundaries,
// ":"-prefixed keep-alive comments) until the connection closes.
func (s *sseStream) read(body io.ReadCloser) {
	defer func() { _ = body.Close() }()
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var name, data string
	var haveData bool
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, ":"):
			// keep-alive comment; ignore
		case strings.HasPrefix(line, "event:"):
			name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			haveData = true
		case line == "":
			if haveData {
				select {
				case s.events <- sseEvent{name: name, data: []byte(data)}:
				case <-time.After(time.Second):
				}
			}
			name, data, haveData = "", "", false
		}
	}
}

func (s *sseStream) close() { s.cancel() }

// waitFor returns the next event with the given name, discarding others (a
// stray keep-alive or presence tick), and fails on timeout.
func (s *sseStream) waitFor(name string, timeout time.Duration) sseEvent {
	s.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-s.events:
			if ev.name == name {
				return ev
			}
		case <-deadline:
			s.t.Fatalf("timed out waiting for %q event", name)
		}
	}
}

func presenceOf(t *testing.T, ev sseEvent) int {
	t.Helper()
	var p struct {
		Count int `json:"count"`
	}
	require.NoError(t, json.Unmarshal(ev.data, &p))
	return p.Count
}

// TestThreadSSELiveEvents drives the full live-thread loop over a real SSE
// connection and real Redis pub/sub: presence on connect, comment.created from
// a REST post, reaction.updated on toggle, a presence rise/fall from a second
// reader, and comment.deleted — all pushed without polling.
func TestThreadSSELiveEvents(t *testing.T) {
	animeID := seedAnime(t, 900010, "SSE Show", "SSE Show", 12)

	alice := newClient(t)
	alice.register("sse_alice")
	bob := newClient(t)
	bob.register("sse_bob")

	// Alice opens (creates) the episode-1 thread.
	var thread struct {
		Thread struct {
			Id int64 `json:"id"`
		} `json:"thread"`
	}
	require.Equal(t, http.StatusOK,
		alice.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/episodes/1/thread", nil, &thread))
	base := "/api/v1/threads/" + itoa(thread.Thread.Id)

	// A reader connects and immediately learns it is alone (presence 1). We
	// wait for this before posting — it proves the subscription is live, so
	// the subsequent broadcast can't race ahead of registration.
	stream := openSSE(t, base+"/events")
	defer stream.close()
	assert.Equal(t, 1, presenceOf(t, stream.waitFor("presence", 3*time.Second)))

	// A REST comment arrives on the stream as comment.created, carrying the
	// same shape the client already caches.
	var posted struct {
		Id int64 `json:"id"`
	}
	require.Equal(t, http.StatusCreated,
		bob.do(http.MethodPost, base+"/comments", map[string]any{"body": "live from the thread"}, &posted))

	created := stream.waitFor("comment.created", 3*time.Second)
	var comment struct {
		Id   int64  `json:"id"`
		Body string `json:"body"`
	}
	require.NoError(t, json.Unmarshal(created.data, &comment))
	assert.Equal(t, posted.Id, comment.Id)
	assert.Equal(t, "live from the thread", comment.Body)

	// Reaction toggles broadcast the emoji's new absolute count.
	reactPath := "/api/v1/comments/" + itoa(posted.Id) + "/reactions/heart"
	require.Equal(t, http.StatusNoContent, bob.do(http.MethodPut, reactPath, nil, nil))
	var ru struct {
		CommentId int64  `json:"comment_id"`
		Emoji     string `json:"emoji"`
		Count     int    `json:"count"`
	}
	require.NoError(t, json.Unmarshal(stream.waitFor("reaction.updated", 3*time.Second).data, &ru))
	assert.Equal(t, posted.Id, ru.CommentId)
	assert.Equal(t, "heart", ru.Emoji)
	assert.Equal(t, 1, ru.Count)

	require.Equal(t, http.StatusNoContent, bob.do(http.MethodDelete, reactPath, nil, nil))
	require.NoError(t, json.Unmarshal(stream.waitFor("reaction.updated", 3*time.Second).data, &ru))
	assert.Equal(t, 0, ru.Count, "removing the reaction drops the count to 0")

	// A second reader lifts presence to 2, and leaving drops it back to 1.
	stream2 := openSSE(t, base+"/events")
	assert.Equal(t, 2, presenceOf(t, stream.waitFor("presence", 3*time.Second)))
	stream2.close()
	assert.Equal(t, 1, presenceOf(t, stream.waitFor("presence", 3*time.Second)))

	// Deleting the comment broadcasts comment.deleted.
	require.Equal(t, http.StatusNoContent,
		bob.do(http.MethodDelete, "/api/v1/comments/"+itoa(posted.Id), nil, nil))
	var cd struct {
		CommentId int64 `json:"comment_id"`
	}
	require.NoError(t, json.Unmarshal(stream.waitFor("comment.deleted", 3*time.Second).data, &cd))
	assert.Equal(t, posted.Id, cd.CommentId)
}
