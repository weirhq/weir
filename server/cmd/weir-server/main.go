// Command weir-server is the Weir media server: the only process clients and
// peers talk to.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/admin"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/config"
	"github.com/weirhq/weir/server/internal/engine"
	"github.com/weirhq/weir/server/internal/jobs"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/metadata"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/web"
)

// version is the server's release version, set by release builds.
var version = "0.0.0-dev"

func main() {
	configPath := flag.String("config", envOr("WEIR_CONFIG", "weir.toml"), "path to weir.toml; empty to use only environment variables")
	checkMigrations := flag.Bool("check-migrations", false, "list pending database migrations and exit without applying them")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *configPath, *checkMigrations); err != nil {
		fmt.Fprintln(os.Stderr, "weir-server:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, configPath string, checkMigrations bool) error {
	cfg, err := config.Load(configPath, os.LookupEnv)
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	if cfg.TLSMode == config.TLSACME {
		return errors.New("tls_mode \"acme\" is not implemented yet; use \"off\" behind a reverse proxy or tunnel")
	}

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	if checkMigrations {
		pending, err := st.Pending(ctx)
		if err != nil {
			return err
		}
		riverPending, err := jobs.Pending(ctx, st.Pool)
		if err != nil {
			return err
		}
		pending = append(pending, riverPending...)
		if len(pending) == 0 {
			fmt.Println("No pending migrations.")
		}
		for _, m := range pending {
			fmt.Println("pending:", m)
		}
		return nil
	}
	if err := st.Migrate(ctx); err != nil {
		return err
	}
	if err := jobs.Migrate(ctx, st.Pool); err != nil {
		return err
	}

	sup, err := engine.New(cfg.EngineSocket, cfg.EngineCommand)
	if err != nil {
		return err
	}
	go sup.Run(ctx)

	workers := river.NewWorkers()
	river.AddWorker(workers, &library.ScanWorker{
		Scanner: library.NewScanner(st, sup.Client()),
		AfterScan: func(ctx context.Context, libraryID uuid.UUID) error {
			_, err := river.ClientFromContext[pgx.Tx](ctx).Insert(ctx, metadata.RefreshArgs{LibraryID: libraryID}, nil)
			return err
		},
	})
	river.AddWorker(workers, &metadata.RefreshWorker{Refresher: newRefresher(st, cfg.Metadata)})
	jobClient, err := jobs.NewClient(st.Pool, workers)
	if err != nil {
		return err
	}
	if err := jobClient.Start(ctx); err != nil {
		return err
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = jobClient.Stop(stopCtx)
	}()

	key, err := auth.LoadServerKey(ctx, st)
	if err != nil {
		return err
	}
	tokens := auth.NewTokens(key, cfg.BaseURL)
	authService, err := auth.NewService(st, tokens)
	if err != nil {
		return err
	}

	interceptors := connect.WithInterceptors(auth.NewInterceptor(tokens))
	mux := http.NewServeMux()
	mux.Handle(apiv1alpha.NewAuthHandler(authService, interceptors))
	mux.Handle(apiv1alpha.NewAdminHandler(admin.NewService(st, cfg.LibraryPaths, jobClient), interceptors))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("/", web.Handler(webFS))

	var protocols http.Protocols
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		Protocols:         &protocols,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Listen, "base_url", cfg.BaseURL)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// newRefresher turns on each online provider whose setting is filled in.
func newRefresher(st *store.Store, cfg config.Metadata) *metadata.Refresher {
	var tmdb *metadata.TMDB
	if cfg.TMDB.APIKey != "" {
		tmdb = metadata.NewTMDB(cfg.TMDB.APIKey, cfg.Language)
	}
	var mb *metadata.MusicBrainz
	if cfg.MusicBrainz.Contact != "" {
		mb = metadata.NewMusicBrainz(cfg.MusicBrainz.Contact, version)
	}
	slog.Info("metadata providers", "tmdb", tmdb != nil, "musicbrainz", mb != nil, "language", cfg.Language)
	return metadata.NewRefresher(st, tmdb, mb)
}

func envOr(name, fallback string) string {
	if v, ok := os.LookupEnv(name); ok {
		return v
	}
	return fallback
}
