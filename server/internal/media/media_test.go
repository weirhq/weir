package media

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
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
