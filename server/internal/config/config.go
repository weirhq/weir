// Package config loads weir.toml with environment-variable overrides and
// reports every problem at once.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

type TLSMode string

const (
	// TLSOff serves plain HTTP, for use behind a reverse proxy or tunnel.
	TLSOff TLSMode = "off"
	// TLSACME terminates TLS with a Let's Encrypt certificate.
	TLSACME TLSMode = "acme"
)

type Config struct {
	DatabaseURL  string   `toml:"database_url"`
	LibraryPaths []string `toml:"library_paths"`
	EngineSocket string   `toml:"engine_socket"`
	SegmentDir   string   `toml:"segment_dir"`
	BaseURL      string   `toml:"base_url"`
	TLSMode      TLSMode  `toml:"tls_mode"`

	// Optional.
	Listen  string `toml:"listen"`
	DataDir string `toml:"data_dir"`
	// The engine binary and its arguments, for the server to run and restart.
	// Empty when the engine runs on its own, as in Docker Compose.
	EngineCommand []string `toml:"engine_command"`
}

const (
	DefaultListen  = ":8320"
	DefaultDataDir = "data"
)

// envVars maps each override to the field it sets. Lists are separated by the
// OS path-list separator, like PATH.
var envVars = map[string]func(*Config, string){
	"WEIR_DATABASE_URL":  func(c *Config, v string) { c.DatabaseURL = v },
	"WEIR_LIBRARY_PATHS": func(c *Config, v string) { c.LibraryPaths = filepath.SplitList(v) },
	"WEIR_ENGINE_SOCKET": func(c *Config, v string) { c.EngineSocket = v },
	"WEIR_SEGMENT_DIR":   func(c *Config, v string) { c.SegmentDir = v },
	"WEIR_BASE_URL":      func(c *Config, v string) { c.BaseURL = v },
	"WEIR_TLS_MODE":      func(c *Config, v string) { c.TLSMode = TLSMode(v) },
	"WEIR_LISTEN":        func(c *Config, v string) { c.Listen = v },
	"WEIR_DATA_DIR":      func(c *Config, v string) { c.DataDir = v },
	// Split on spaces, so paths with spaces need weir.toml.
	"WEIR_ENGINE_COMMAND": func(c *Config, v string) { c.EngineCommand = strings.Fields(v) },
}

// Load reads the file at path, if path is non-empty, then applies overrides
// from lookupEnv. The returned error joins every problem found.
func Load(path string, lookupEnv func(string) (string, bool)) (*Config, error) {
	cfg := &Config{}
	var errs []error

	if path != "" {
		if err := decodeFile(path, cfg); err != nil {
			errs = append(errs, err)
		}
	}
	for name, set := range envVars {
		if v, ok := lookupEnv(name); ok {
			set(cfg, v)
		}
	}
	if cfg.Listen == "" {
		cfg.Listen = DefaultListen
	}
	if cfg.DataDir == "" {
		cfg.DataDir = DefaultDataDir
	}

	errs = append(errs, cfg.validate()...)
	if len(errs) > 0 {
		return nil, errors.Join(errs...)
	}
	return cfg, nil
}

func decodeFile(path string, cfg *Config) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	err = toml.NewDecoder(f).DisallowUnknownFields().Decode(cfg)
	var strict *toml.StrictMissingError
	if errors.As(err, &strict) {
		// Known fields were still decoded; report the unknown ones and keep going.
		var keys []string
		for _, e := range strict.Errors {
			keys = append(keys, strings.Join(e.Key(), "."))
		}
		return fmt.Errorf("%s: unknown keys: %s", path, strings.Join(keys, ", "))
	}
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

func (c *Config) validate() []error {
	var errs []error
	required := func(name, value string) {
		if value == "" {
			errs = append(errs, fmt.Errorf("%s is required", name))
		}
	}
	absolute := func(name, value string) {
		if value != "" && !filepath.IsAbs(value) {
			errs = append(errs, fmt.Errorf("%s must be an absolute path, got %q", name, value))
		}
	}

	required("database_url", c.DatabaseURL)
	required("engine_socket", c.EngineSocket)
	required("segment_dir", c.SegmentDir)
	required("base_url", c.BaseURL)
	required("tls_mode", string(c.TLSMode))
	absolute("engine_socket", c.EngineSocket)
	absolute("segment_dir", c.SegmentDir)

	if len(c.LibraryPaths) == 0 {
		errs = append(errs, errors.New("library_paths needs at least one path"))
	}
	for _, p := range c.LibraryPaths {
		absolute("library_paths", p)
	}

	if c.BaseURL != "" {
		u, err := url.Parse(c.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, fmt.Errorf("base_url must be an absolute http or https URL, got %q", c.BaseURL))
		}
	}
	switch c.TLSMode {
	case "", TLSOff, TLSACME:
	default:
		errs = append(errs, fmt.Errorf("tls_mode must be %q or %q, got %q", TLSOff, TLSACME, c.TLSMode))
	}
	return errs
}
