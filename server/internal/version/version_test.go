package version

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestCheckEngine(t *testing.T) {
	for _, tc := range []struct {
		engine string
		ok     bool
	}{
		{"0.1.0", true},
		{"0.1.7", true},
		{"0.1.7+build.3", true},
		{"0.2.0-rc.1", false},
		{"0.2.0", false},
		{"1.0.0", false},
		{"0.1.0-rc.2", false},
		{"0.0.9", false},
		{"0.0.0", false},
		{"", false},
		{"0.1", false},
		{"0.01.0", false},
		{"v0.1.0", false},
	} {
		err := CheckEngine(tc.engine)
		if (err == nil) != tc.ok {
			t.Errorf("CheckEngine(%q) = %v, want ok=%v", tc.engine, err, tc.ok)
		}
	}
	err := CheckEngine("0.2.0")
	for _, want := range []string{"weir-engine 0.2.0", "weir-server " + Server, MinEngine, MaxEngine} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("message %q doesn't name %q", err, want)
		}
	}
}

// The engine in this repo is one this server accepts, and Cargo and Bazel
// agree on its version. Paths work from the source tree and from Bazel's
// runfiles, which mirror it.
func TestRepoEngineIsCompatible(t *testing.T) {
	cargo := read(t, "../../../engine/Cargo.toml")
	bzl := read(t, "../../../engine/version.bzl")
	cargoVersion := find(t, cargo, `(?m)^\[workspace\.package\][^\[]*?^version = "([^"]+)"`)
	bazelVersion := find(t, bzl, `(?m)^ENGINE_VERSION = "([^"]+)"`)
	if cargoVersion != bazelVersion {
		t.Fatalf("engine/Cargo.toml says %s but engine/version.bzl says %s", cargoVersion, bazelVersion)
	}
	if err := CheckEngine(cargoVersion); err != nil {
		t.Fatal(err)
	}
}

// Bazel packaging names release files from version.bzl.
func TestBazelServerVersion(t *testing.T) {
	got := find(t, read(t, "version.bzl"), `(?m)^SERVER_VERSION = "([^"]+)"`)
	if got != Server {
		t.Fatalf("version.bzl says %s but version.go says %s", got, Server)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func find(t *testing.T, s, pattern string) string {
	t.Helper()
	m := regexp.MustCompile(pattern).FindStringSubmatch(s)
	if m == nil {
		t.Fatalf("no match for %s", pattern)
	}
	return m[1]
}
