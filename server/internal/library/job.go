package library

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

// ScanArgs is the river job that scans one library.
type ScanArgs struct {
	LibraryID uuid.UUID `json:"library_id"`
}

func (ScanArgs) Kind() string { return "scan_library" }

// A scan already waiting or running for the library absorbs a new request.
func (ScanArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{
		ByArgs: true,
		ByState: []rivertype.JobState{
			rivertype.JobStateAvailable,
			rivertype.JobStatePending,
			rivertype.JobStateRetryable,
			rivertype.JobStateRunning,
			rivertype.JobStateScheduled,
		},
	}}
}

type ScanWorker struct {
	river.WorkerDefaults[ScanArgs]
	Scanner *Scanner
}

// Timeout is disabled: a first scan of a large library takes as long as it
// takes, and river's default is a minute.
func (*ScanWorker) Timeout(*river.Job[ScanArgs]) time.Duration { return -1 }

func (w *ScanWorker) Work(ctx context.Context, job *river.Job[ScanArgs]) error {
	started := time.Now()
	res, err := w.Scanner.Scan(ctx, job.Args.LibraryID)
	if errors.Is(err, ErrNoLibrary) {
		return river.JobCancel(err)
	}
	if err != nil {
		return err
	}
	slog.InfoContext(ctx, "library scanned", "library", job.Args.LibraryID, "took", time.Since(started).Round(time.Millisecond),
		"added", res.Added, "updated", res.Updated, "unchanged", res.Unchanged, "removed", res.Removed,
		"unmatched", res.Unmatched, "failed", res.Failed)
	return nil
}

// Inserter is the part of a river client that queues jobs.
type Inserter interface {
	Insert(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

// QueueScan queues a scan of the library.
func QueueScan(ctx context.Context, jobs Inserter, libraryID uuid.UUID) error {
	_, err := jobs.Insert(ctx, ScanArgs{LibraryID: libraryID}, nil)
	return err
}
