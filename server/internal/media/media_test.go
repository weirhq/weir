package media

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

func newSigner(t *testing.T) *Signer {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewSigner(key)
}

type files map[uuid.UUID]string

func (f files) GetMediaFilePath(_ context.Context, id uuid.UUID) (string, error) {
	if p, ok := f[id]; ok {
		return p, nil
	}
	return "", pgx.ErrNoRows
}

func TestServesSignedFilesWithRanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "film.mkv")
	if err := os.WriteFile(path, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	id, user := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	s := newSigner(t)
	srv := httptest.NewServer(Handler(s, files{id: path}))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+s.FileURL(id, user, time.Hour), nil)
	req.Header.Set("Range", "bytes=2-5")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Errorf("range: %d %q", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "matroska") {
		t.Errorf("content type %q", ct)
	}
}

func TestRejectsBadURLs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "film.mkv")
	_ = os.WriteFile(path, []byte("x"), 0o644)
	id, other, user := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	s := newSigner(t)
	h := Handler(s, files{id: path, other: path})

	get := func(target string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		return rec.Code
	}
	good := s.FileURL(id, user, time.Hour)
	if code := get(good); code != http.StatusOK {
		t.Fatalf("good URL: %d", code)
	}
	cases := map[string]string{
		"unsigned":      FilePrefix + id.String(),
		"another file":  strings.Replace(good, id.String(), other.String(), 1),
		"another user":  strings.Replace(good, user.String(), uuid.Must(uuid.NewV7()).String(), 1),
		"other key":     newSigner(t).FileURL(id, user, time.Hour),
		"expired":       s.FileURL(id, user, -time.Minute),
		"edited expiry": strings.Replace(good, "exp=", "exp=9", 1),
	}
	for name, target := range cases {
		if code := get(target); code != http.StatusForbidden {
			t.Errorf("%s: %d, want 403", name, code)
		}
	}
	if code := get(s.FileURL(uuid.Must(uuid.NewV7()), user, time.Hour)); code != http.StatusNotFound {
		t.Errorf("unknown file: %d", code)
	}
}

func TestVerifyReturnsTheUser(t *testing.T) {
	s := newSigner(t)
	user := uuid.Must(uuid.NewV7())
	r := httptest.NewRequest(http.MethodGet, s.FileURL(uuid.Must(uuid.NewV7()), user, time.Minute), nil)
	got, err := s.Verify(r)
	if err != nil || got != user {
		t.Errorf("got %v %v", got, err)
	}
	if _, err := s.Verify(httptest.NewRequest(http.MethodGet, "/media/files/x", nil)); !errors.Is(err, errBadSignature) {
		t.Errorf("unsigned: %v", err)
	}
}

func TestScopedSignatures(t *testing.T) {
	s := newSigner(t)
	user := uuid.Must(uuid.NewV7())
	q := s.SignScope("/media/sessions/abc/", user, time.Minute)
	for path, ok := range map[string]bool{
		"/media/sessions/abc/3.m4s":        true,
		"/media/sessions/abc/index.m3u8":   true,
		"/media/sessions/abcd/3.m4s":       false,
		"/media/sessions/other/3.m4s":      false,
		"/media/sessions/abc/../xyz/3.m4s": false,
	} {
		_, err := s.Verify(httptest.NewRequest(http.MethodGet, path+"?"+q, nil))
		if (err == nil) != ok {
			t.Errorf("%s: err %v, want ok=%v", path, err, ok)
		}
	}
	if _, err := s.Verify(httptest.NewRequest(http.MethodGet, "/media/sessions/abc/1.m4s?"+s.SignScope("/media/sessions/abc", user, time.Minute), nil)); err == nil {
		t.Error("accepted a scope without a trailing slash")
	}
}

type subtitleEngine struct{ calls int }

func (e *subtitleEngine) ExtractSubtitle(_ context.Context, in *enginev1alpha.ExtractSubtitleRequest, _ ...grpc.CallOption) (*enginev1alpha.ExtractSubtitleResponse, error) {
	e.calls++
	if in.GetIndex() != 2 {
		return nil, status.Error(codes.NotFound, "no subtitle there")
	}
	return &enginev1alpha.ExtractSubtitleResponse{Webvtt: "WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n"}, nil
}

func TestServesSubtitlesAsWebVTT(t *testing.T) {
	path := filepath.Join(t.TempDir(), "film.mkv")
	if err := os.WriteFile(path, []byte("bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	id, user := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	s := newSigner(t)
	engine := &subtitleEngine{}
	srv := httptest.NewServer(SubtitleHandler(s, files{id: path}, engine, t.TempDir()))
	defer srv.Close()
	get := func(url string) (int, string, string) {
		t.Helper()
		resp, err := http.Get(srv.URL + url)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header.Get("Content-Type"), string(body)
	}
	for range 2 {
		code, ct, body := get(s.SubtitleURL(id, 2, user, time.Hour))
		if code != http.StatusOK || !strings.HasPrefix(ct, "text/vtt") || !strings.Contains(body, "Hello") {
			t.Fatalf("subtitle: %d %s %q", code, ct, body)
		}
	}
	// Converted once, then kept.
	if engine.calls != 1 {
		t.Errorf("%d conversions, want 1", engine.calls)
	}
	if code, _, _ := get(s.SubtitleURL(id, 5, user, time.Hour)); code != http.StatusNotFound {
		t.Errorf("no such stream: %d", code)
	}
	if code, _, _ := get(fmt.Sprintf("%s%s/2.vtt", SubtitlePrefix, id)); code != http.StatusForbidden {
		t.Errorf("unsigned: %d", code)
	}
}
