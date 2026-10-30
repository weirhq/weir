package playback

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/media"
	"github.com/weirhq/weir/server/internal/playback/playbacktest"
)

type sessionHarness struct {
	engine   *playbacktest.Engine
	sessions *Sessions
	srv      *httptest.Server
	user     uuid.UUID
}

func newSessionHarness(t *testing.T, engine *playbacktest.Engine) *sessionHarness {
	t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	s := NewSessions(engine.Client(t), t.TempDir(), media.NewSigner(key))
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &sessionHarness{engine: engine, sessions: s, srv: srv, user: uuid.Must(uuid.NewV7())}
}

func (h *sessionHarness) get(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(h.srv.URL + url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

// sibling turns a playlist URL into the URL of another file in the session,
// with the same signature, as a player resolving a relative URI does.
func sibling(playlistURL, name string) string {
	path, query, _ := strings.Cut(playlistURL, "?")
	return strings.TrimSuffix(path, "index.m3u8") + name + "?" + query
}

func TestVODSession(t *testing.T) {
	h := newSessionHarness(t, &playbacktest.Engine{})
	ctx := context.Background()
	id, url, err := h.sessions.Start(ctx, h.user, "/media/film.mkv", 57*time.Second, &enginev1alpha.OutputProfile{}, true)
	if err != nil {
		t.Fatal(err)
	}

	code, playlist := h.get(t, url)
	if code != http.StatusOK {
		t.Fatalf("playlist: %d %s", code, playlist)
	}
	_, query, _ := strings.Cut(url, "?")
	for _, want := range []string{"#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MAP:URI=\"init.mp4?" + query, "\n0.m4s?" + query, "#EXTINF:3.000,\n9.m4s?", "#EXT-X-ENDLIST"} {
		if !strings.Contains(playlist, want) {
			t.Errorf("playlist lacks %q:\n%s", want, playlist)
		}
	}
	if n := strings.Count(playlist, "#EXTINF"); n != 10 {
		t.Errorf("%d segments listed for 57 s, want 10", n)
	}

	if code, body := h.get(t, sibling(url, "init.mp4")); code != http.StatusOK || body != "init" {
		t.Errorf("init: %d %q", code, body)
	}
	if code, body := h.get(t, sibling(url, "1.m4s")); code != http.StatusOK || body != "segment 1" {
		t.Errorf("segment 1: %d %q", code, body)
	}
	// Far past the encoder: the server seeks the engine there.
	if code, body := h.get(t, sibling(url, "9.m4s")); code != http.StatusOK || body != "segment 9" {
		t.Errorf("segment 9: %d %q", code, body)
	}
	if !slices.Contains(h.engine.Seen(), "seek 9") {
		t.Errorf("engine commands %v, want a seek to 9", h.engine.Seen())
	}

	if err := h.sessions.Heartbeat(ctx, id, h.user); err != nil {
		t.Fatal(err)
	}
	if err := h.sessions.Heartbeat(ctx, id, uuid.Must(uuid.NewV7())); err != errNoSession {
		t.Errorf("someone else's heartbeat: %v", err)
	}
	dir := h.sessions.byID[id].dir
	if err := h.sessions.Stop(ctx, id, h.user); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("segments left behind: %v", err)
	}
	if code, _ := h.get(t, url); code != http.StatusNotFound {
		t.Errorf("playlist after stop: %d", code)
	}
	if seen := h.engine.Seen(); !slices.Contains(seen, "heartbeat") || !slices.Contains(seen, "stop") {
		t.Errorf("engine commands %v", seen)
	}
}

func TestEventSessionListsWhatExists(t *testing.T) {
	h := newSessionHarness(t, &playbacktest.Engine{Finish: true})
	_, url, err := h.sessions.Start(context.Background(), h.user, "/media/film.mkv", time.Hour, &enginev1alpha.OutputProfile{}, false)
	if err != nil {
		t.Fatal(err)
	}
	// Wait for the fake to finish its three segments.
	if code, _ := h.get(t, sibling(url, "2.m4s")); code != http.StatusOK {
		t.Fatalf("segment 2: %d", code)
	}
	deadline := time.Now().Add(2 * time.Second)
	var playlist string
	for time.Now().Before(deadline) {
		_, playlist = h.get(t, url)
		if strings.Contains(playlist, "#EXT-X-ENDLIST") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(playlist, "#EXT-X-PLAYLIST-TYPE:EVENT") || strings.Count(playlist, "#EXTINF") != 3 || !strings.Contains(playlist, "#EXT-X-ENDLIST") {
		t.Errorf("playlist:\n%s", playlist)
	}
	if code, _ := h.get(t, sibling(url, "3.m4s")); code != http.StatusNotFound {
		t.Errorf("past the end: %d", code)
	}
}

func TestSessionLinksAreTheirUsersOnly(t *testing.T) {
	h := newSessionHarness(t, &playbacktest.Engine{})
	_, url, err := h.sessions.Start(context.Background(), h.user, "/media/film.mkv", time.Minute, &enginev1alpha.OutputProfile{}, true)
	if err != nil {
		t.Fatal(err)
	}
	path, _, _ := strings.Cut(url, "?")
	if code, _ := h.get(t, path); code != http.StatusForbidden {
		t.Errorf("unsigned: %d", code)
	}
	// A valid signature for another user's session id doesn't reach it.
	scope := strings.TrimSuffix(path, "index.m3u8")
	other := scope + "index.m3u8?" + h.sessions.signer.SignScope(scope, uuid.Must(uuid.NewV7()), time.Minute)
	if code, _ := h.get(t, other); code != http.StatusNotFound {
		t.Errorf("another user: %d", code)
	}
}

func TestReaperEndsSilentSessions(t *testing.T) {
	h := newSessionHarness(t, &playbacktest.Engine{})
	id, _, err := h.sessions.Start(context.Background(), h.user, "/media/film.mkv", time.Minute, &enginev1alpha.OutputProfile{}, true)
	if err != nil {
		t.Fatal(err)
	}
	h.sessions.reap(context.Background())
	if _, err := h.sessions.get(id, h.user); err != nil {
		t.Fatal("a fresh session was reaped")
	}
	h.sessions.now = func() time.Time { return time.Now().Add(heartbeatTimeout + time.Second) }
	h.sessions.reap(context.Background())
	if _, err := h.sessions.get(id, h.user); err != errNoSession {
		t.Error("a silent session survived the reaper")
	}
}

func TestBusyEngine(t *testing.T) {
	h := newSessionHarness(t, &playbacktest.Engine{Busy: true})
	if _, _, err := h.sessions.Start(context.Background(), h.user, "/media/film.mkv", time.Minute, &enginev1alpha.OutputProfile{}, true); err != ErrBusy {
		t.Errorf("got %v, want ErrBusy", err)
	}
}
