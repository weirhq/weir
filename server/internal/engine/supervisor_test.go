package engine

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

type fakeEngine struct {
	enginev1alpha.UnimplementedEngineServer
	version string
}

func (f *fakeEngine) Capabilities(context.Context, *enginev1alpha.CapabilitiesRequest) (*enginev1alpha.CapabilitiesResponse, error) {
	return &enginev1alpha.CapabilitiesResponse{EngineVersion: f.version, MaxSessions: 2}, nil
}

func (f *fakeEngine) Health(context.Context, *enginev1alpha.HealthRequest) (*enginev1alpha.HealthResponse, error) {
	return &enginev1alpha.HealthResponse{}, nil
}

// socketPath returns a socket path short enough for macOS's 104-byte limit.
func socketPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "weir")
	if err != nil || len(dir) > 80 {
		dir, err = os.MkdirTemp("/tmp", "weir")
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return filepath.Join(dir, "engine.sock")
}

func serveFake(t *testing.T, socket, version string) *grpc.Server {
	t.Helper()
	lis, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer()
	enginev1alpha.RegisterEngineServer(srv, &fakeEngine{version: version})
	go srv.Serve(lis)
	return srv
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTracksHealthAndRereadsCapabilities(t *testing.T) {
	socket := socketPath(t)
	sup, err := New(socket, nil)
	if err != nil {
		t.Fatal(err)
	}
	sup.interval = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { sup.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	if sup.Healthy() || sup.Capabilities() != nil {
		t.Fatal("healthy before any engine exists")
	}

	first := serveFake(t, socket, "0.1.0")
	waitFor(t, "engine up", sup.Healthy)
	if v := sup.Capabilities().GetEngineVersion(); v != "0.1.0" {
		t.Fatalf("engine version = %q", v)
	}

	first.Stop()
	waitFor(t, "engine down", func() bool { return !sup.Healthy() })

	os.Remove(socket)
	second := serveFake(t, socket, "0.1.1")
	t.Cleanup(second.Stop)
	waitFor(t, "engine back up", sup.Healthy)
	if v := sup.Capabilities().GetEngineVersion(); v != "0.1.1" {
		t.Fatalf("capabilities not re-read after restart: version %q", v)
	}
}

func TestRefusesAnIncompatibleEngine(t *testing.T) {
	socket := socketPath(t)
	sup, err := New(socket, nil)
	if err != nil {
		t.Fatal(err)
	}
	sup.interval = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { sup.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	newer := serveFake(t, socket, "0.2.0")
	waitFor(t, "a problem", func() bool { return sup.Problem() != "" })
	if sup.Healthy() {
		t.Error("healthy with an incompatible engine")
	}
	if v := sup.Capabilities().GetEngineVersion(); v != "0.2.0" {
		t.Errorf("capabilities not kept for the status page: version %q", v)
	}

	// Replacing it with a compatible build clears the problem.
	newer.Stop()
	os.Remove(socket)
	fixed := serveFake(t, socket, "0.1.0")
	t.Cleanup(fixed.Stop)
	waitFor(t, "engine up", sup.Healthy)
	if p := sup.Problem(); p != "" {
		t.Errorf("problem %q after a compatible engine came up", p)
	}
}

func TestRestartsTheEngineProcess(t *testing.T) {
	// A stand-in engine that exits at once; the supervisor should keep
	// starting it, passing --socket.
	marker := filepath.Join(t.TempDir(), "runs")
	script := filepath.Join(t.TempDir(), "engine.sh")
	body := "#!/bin/sh\n[ \"$1\" = --socket ] || exit 2\necho run >> " + marker + "\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	sup, err := New(socketPath(t), []string{script})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { sup.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	waitFor(t, "two engine starts", func() bool {
		b, _ := os.ReadFile(marker)
		return len(b) >= len("run\nrun\n")
	})
}
