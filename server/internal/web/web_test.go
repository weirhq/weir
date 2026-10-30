package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func get(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestServesTheApp(t *testing.T) {
	h := Handler(fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html>app")},
		"assets/index-abc.js":  {Data: []byte("console.log(1)")},
		"assets/index-abc.css": {Data: []byte("body{}")},
	})

	rec := get(t, h, http.MethodGet, "/assets/index-abc.js")
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log(1)" {
		t.Fatalf("asset: %d %q", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("asset not cached as immutable: %q", rec.Header().Get("Cache-Control"))
	}

	for _, path := range []string{"/", "/login", "/library/films/123", "/assets/missing.js", "/../../etc/passwd"} {
		rec := get(t, h, http.MethodGet, path)
		if rec.Code != http.StatusOK || rec.Body.String() != "<!doctype html>app" {
			t.Errorf("%s: %d %q, want index.html", path, rec.Code, rec.Body)
		}
		if rec.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s: index cached: %q", path, rec.Header().Get("Cache-Control"))
		}
	}

	if rec := get(t, h, http.MethodPost, "/login"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", rec.Code)
	}
}

func TestWithoutTheApp(t *testing.T) {
	rec := get(t, Handler(nil), http.MethodGet, "/")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "pnpm dev") {
		t.Fatalf("got %d %q", rec.Code, rec.Body)
	}
}
