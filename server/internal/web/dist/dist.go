//go:build webembed

// Package dist embeds the web client's production build. Bazel copies the
// output of //web/app:dist into files/; plain `go build` skips this package
// (see cmd/weir-server/webui_*.go).
package dist

import (
	"embed"
	"io/fs"
)

//go:embed all:files
var files embed.FS

// FS is the Vite build, with index.html at its root.
var FS = func() fs.FS {
	sub, err := fs.Sub(files, "files")
	if err != nil {
		panic(err)
	}
	return sub
}()
