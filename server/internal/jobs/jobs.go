// Package jobs runs background work on river, a Postgres-backed queue.
package jobs

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

// Client is the river client the server uses.
type Client = river.Client[pgx.Tx]

// Workers concurrently processing jobs. Scans are the heavy kind, and each
// one already keeps the engine busy.
const maxWorkers = 2

// Migrate applies river's own schema migrations.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	m, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return err
	}
	if _, err := m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("migrate river: %w", err)
	}
	return nil
}

// Pending lists river migrations Migrate would apply.
func Pending(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	m, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return nil, err
	}
	existing, err := m.ExistingVersions(ctx)
	if err != nil {
		return nil, err
	}
	applied := map[int]bool{}
	for _, v := range existing {
		applied[v.Version] = true
	}
	var pending []string
	for _, v := range m.AllVersions() {
		if !applied[v.Version] {
			pending = append(pending, fmt.Sprintf("river %03d %s", v.Version, v.Name))
		}
	}
	return pending, nil
}

// NewClient returns a client that runs workers once started. With nil
// workers it can only insert jobs.
func NewClient(pool *pgxpool.Pool, workers *river.Workers) (*Client, error) {
	cfg := &river.Config{Workers: workers}
	if workers != nil {
		cfg.Queues = map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: maxWorkers}}
	} else {
		cfg.SkipUnknownJobCheck = true
	}
	return river.NewClient(riverpgxv5.New(pool), cfg)
}
