//go:build webembed

package main

import (
	"io/fs"

	"github.com/weirhq/weir/server/internal/web/dist"
)

// Release builds (Bazel) embed the web client.
var webFS fs.FS = dist.FS
