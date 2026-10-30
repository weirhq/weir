// Package engine connects weir-server to weir-engine over its Unix socket,
// and optionally runs the engine process itself.
package engine

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/version"
)

const (
	HealthInterval = 10 * time.Second
	// While the engine is down, check this often so it's noticed as soon as
	// it starts.
	downInterval = time.Second
	callTimeout  = 5 * time.Second

	// Restart backoff for an engine the server runs.
	minRestartDelay = time.Second
	maxRestartDelay = 30 * time.Second
	// An engine that ran this long before exiting restarts without delay.
	stableRun = time.Minute
)

// Supervisor tracks the engine's health and capabilities. When it has a
// command it also starts the engine and restarts it when it exits; without
// one, something else (Compose, systemd) runs the engine.
type Supervisor struct {
	socket   string
	command  []string
	conn     *grpc.ClientConn
	client   enginev1alpha.EngineClient
	interval time.Duration

	mu      sync.RWMutex
	healthy bool
	caps    *enginev1alpha.CapabilitiesResponse
	health  *enginev1alpha.HealthResponse
	// Why a running engine isn't used, e.g. an incompatible version.
	problem string
}

func New(socket string, command []string) (*Supervisor, error) {
	conn, err := grpc.NewClient("unix:"+socket, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &Supervisor{
		socket:   socket,
		command:  command,
		conn:     conn,
		client:   enginev1alpha.NewEngineClient(conn),
		interval: HealthInterval,
	}, nil
}

func (s *Supervisor) Client() enginev1alpha.EngineClient { return s.client }

func (s *Supervisor) Healthy() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.healthy
}

// Problem says why a running engine isn't being used, or is empty.
func (s *Supervisor) Problem() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.problem
}

// Capabilities returns what the engine last reported on coming up, or nil
// if it never has. An engine with a Problem has capabilities but isn't
// healthy.
func (s *Supervisor) Capabilities() *enginev1alpha.CapabilitiesResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.caps
}

// LastHealth returns the engine's latest Health reply, or nil while it is
// down.
func (s *Supervisor) LastHealth() *enginev1alpha.HealthResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.health
}

// Run supervises the engine until ctx is done, then closes the connection.
func (s *Supervisor) Run(ctx context.Context) {
	defer s.conn.Close()
	var wg sync.WaitGroup
	if len(s.command) > 0 {
		wg.Go(func() { s.runProcess(ctx) })
	}
	for {
		s.check(ctx)
		wait := s.interval
		if !s.Healthy() {
			wait = min(wait, downInterval)
		}
		select {
		case <-ctx.Done():
			wg.Wait()
			return
		case <-time.After(wait):
		}
	}
}

// check polls Health and re-reads Capabilities whenever the engine comes
// (back) up, since a restarted engine may be a different build. An engine
// whose version this server doesn't work with is never healthy.
func (s *Supervisor) check(ctx context.Context) {
	callCtx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	health, err := s.client.Health(callCtx, &enginev1alpha.HealthRequest{})
	healthy := err == nil
	var caps *enginev1alpha.CapabilitiesResponse
	problem := ""
	if healthy && !s.Healthy() {
		caps, err = s.client.Capabilities(callCtx, &enginev1alpha.CapabilitiesRequest{})
		healthy = err == nil
		if healthy {
			if verr := version.CheckEngine(caps.GetEngineVersion()); verr != nil {
				healthy, problem = false, verr.Error()
			}
		}
	}

	s.mu.Lock()
	was, wasProblem := s.healthy, s.problem
	s.healthy = healthy
	s.health = health
	s.problem = problem
	if caps != nil {
		s.caps = caps
	}
	s.mu.Unlock()

	if problem != "" && problem != wasProblem {
		slog.Error("not using the engine", "socket", s.socket, "err", problem)
	}
	switch {
	case healthy && !was:
		slog.Info("engine up", "socket", s.socket, "engine", caps.GetEngineVersion(),
			"ffmpeg", caps.GetFfmpegVersion(), "max_sessions", caps.GetMaxSessions())
	case !healthy && was:
		slog.Warn("engine down", "socket", s.socket, "err", err)
	}
}

// runProcess starts the engine and restarts it with backoff whenever it
// exits, until ctx is done.
func (s *Supervisor) runProcess(ctx context.Context) {
	delay := minRestartDelay
	for {
		started := time.Now()
		cmd := exec.CommandContext(ctx, s.command[0], append(s.command[1:], "--socket", s.socket)...)
		cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
		cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
		cmd.WaitDelay = 10 * time.Second

		err := cmd.Run()
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			err = errors.New("exit status 0")
		}
		if time.Since(started) > stableRun {
			delay = minRestartDelay
		}
		slog.Error("engine exited; restarting", "err", err, "in", delay)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(delay*2, maxRestartDelay)
	}
}
