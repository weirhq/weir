//go:build !webembed

package main

import "io/fs"

// Without the webembed tag (`go run`), the web client comes from Vite's dev
// server instead.
var webFS fs.FS
