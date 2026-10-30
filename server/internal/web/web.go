// Package web serves the single-page app built from web/app.
package web

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const notBuilt = `This weir-server was built without the web client.
In development, run "pnpm dev" in web/ and open http://localhost:5173.
`

// Handler serves files from dist, and index.html for any other GET so the
// client-side router can handle the path. A nil dist serves a short
// explanation instead.
func Handler(dist fs.FS) http.Handler {
	var index []byte
	if dist != nil {
		index, _ = fs.ReadFile(dist, "index.html")
	}
	if index == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(notBuilt))
		})
	}
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if info, err := fs.Stat(dist, name); err == nil && !info.IsDir() {
				// Vite puts a content hash in every asset name.
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}
