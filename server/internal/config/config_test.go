package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validTOML = `
database_url = "postgres://weir@localhost/weir"
library_paths = ["/media/films", "/media/music"]
engine_socket = "/run/weir/engine.sock"
segment_dir = "/var/cache/weir/segments"
base_url = "https://weir.example.org"
tls_mode = "off"
`

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "weir.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func noEnv(string) (string, bool) { return "", false }

func envMap(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestLoadValidFile(t *testing.T) {
	cfg, err := Load(writeConfig(t, validTOML), noEnv)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "https://weir.example.org" || len(cfg.LibraryPaths) != 2 || cfg.TLSMode != TLSOff {
		t.Errorf("unexpected config: %+v", cfg)
	}
	if cfg.Listen != DefaultListen || cfg.DataDir != DefaultDataDir {
		t.Errorf("defaults not applied: listen %q, data_dir %q", cfg.Listen, cfg.DataDir)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	cfg, err := Load(writeConfig(t, validTOML), envMap(map[string]string{
		"WEIR_BASE_URL":       "http://localhost:8320",
		"WEIR_LIBRARY_PATHS":  "/a" + string(os.PathListSeparator) + "/b" + string(os.PathListSeparator) + "/c",
		"WEIR_ENGINE_COMMAND": "/usr/lib/weir/weir-engine --ffprobe /usr/lib/weir/ffprobe",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "http://localhost:8320" {
		t.Errorf("base_url = %q", cfg.BaseURL)
	}
	if strings.Join(cfg.LibraryPaths, ",") != "/a,/b,/c" {
		t.Errorf("library_paths = %v", cfg.LibraryPaths)
	}
	if len(cfg.EngineCommand) != 3 || cfg.EngineCommand[2] != "/usr/lib/weir/ffprobe" {
		t.Errorf("engine_command = %q", cfg.EngineCommand)
	}
}

func TestEnvOnly(t *testing.T) {
	_, err := Load("", envMap(map[string]string{
		"WEIR_DATABASE_URL":  "postgres://localhost/weir",
		"WEIR_LIBRARY_PATHS": "/media",
		"WEIR_ENGINE_SOCKET": "/run/engine.sock",
		"WEIR_SEGMENT_DIR":   "/tmp/segments",
		"WEIR_BASE_URL":      "https://weir.example.org",
		"WEIR_TLS_MODE":      "acme",
	}))
	if err != nil {
		t.Fatal(err)
	}
}

func TestReportsEveryProblemAtOnce(t *testing.T) {
	_, err := Load(writeConfig(t, `
library_paths = ["relative/path"]
segment_dir = "segments"
base_url = "weir.example.org"
tls_mode = "sometimes"
colour = "blue"
`), noEnv)
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{
		"unknown keys: colour",
		"database_url is required",
		"engine_socket is required",
		"segment_dir must be an absolute path",
		"library_paths must be an absolute path",
		"base_url must be an absolute http or https URL",
		"tls_mode must be",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q:\n%v", want, err)
		}
	}
}

func TestMissingFile(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "absent.toml"), noEnv)
	if err == nil || !strings.Contains(err.Error(), "absent.toml") {
		t.Fatalf("want an error naming the file, got %v", err)
	}
}
