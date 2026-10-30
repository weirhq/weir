// Package playbacktest provides a fake engine for session tests: a real
// gRPC server in memory that writes small segment files on demand.
package playbacktest

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

// Engine writes three segments from wherever a session starts or seeks to.
// With Finish set it then reports the session finished.
type Engine struct {
	enginev1alpha.UnimplementedEngineServer
	// Busy makes StartSession fail as a full engine does.
	Busy bool
	// Finish ends each run after its segments, like a remux reaching the end.
	Finish bool

	mu       sync.Mutex
	sessions map[string]chan *enginev1alpha.ControlSessionRequest
	// Commands received, as "seek 9", "heartbeat" or "stop".
	Commands []string
}

// Client starts e on an in-memory listener and returns a client for it.
func (e *Engine) Client(t *testing.T) enginev1alpha.EngineClient {
	t.Helper()
	e.sessions = map[string]chan *enginev1alpha.ControlSessionRequest{}
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	enginev1alpha.RegisterEngineServer(srv, e)
	go srv.Serve(lis)
	t.Cleanup(srv.Stop)
	conn, err := grpc.NewClient("passthrough:///engine",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return enginev1alpha.NewEngineClient(conn)
}

// Seen returns a copy of the commands received so far.
func (e *Engine) Seen() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.Commands...)
}

func (e *Engine) StartSession(req *enginev1alpha.StartSessionRequest, stream grpc.ServerStreamingServer[enginev1alpha.StartSessionResponse]) error {
	if e.Busy {
		return status.Error(codes.ResourceExhausted, "the engine is running its maximum of 1 sessions")
	}
	commands := make(chan *enginev1alpha.ControlSessionRequest, 8)
	e.mu.Lock()
	e.sessions[req.GetSessionId()] = commands
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(e.sessions, req.GetSessionId())
		e.mu.Unlock()
	}()

	send := func(ev *enginev1alpha.SessionEvent) error {
		return stream.Send(&enginev1alpha.StartSessionResponse{Event: ev})
	}
	dir := req.GetOutputDir()
	init := filepath.Join(dir, "init.mp4")
	if err := os.WriteFile(init, []byte("init"), 0o644); err != nil {
		return err
	}
	if err := send(&enginev1alpha.SessionEvent{Event: &enginev1alpha.SessionEvent_Ready{Ready: &enginev1alpha.SessionReady{InitSegment: init}}}); err != nil {
		return err
	}
	produce := func(from uint32) error {
		for i := from; i < from+3; i++ {
			path := filepath.Join(dir, fmt.Sprintf("%d.m4s", i))
			if err := os.WriteFile(path, []byte(fmt.Sprintf("segment %d", i)), 0o644); err != nil {
				return err
			}
			seg := &enginev1alpha.SegmentReady{Index: i, Path: path, Duration: req.GetSegmentDuration()}
			if err := send(&enginev1alpha.SessionEvent{Event: &enginev1alpha.SessionEvent_Segment{Segment: seg}}); err != nil {
				return err
			}
		}
		if e.Finish {
			return send(&enginev1alpha.SessionEvent{Event: &enginev1alpha.SessionEvent_Finished{Finished: &enginev1alpha.SessionFinished{}}})
		}
		return nil
	}
	if err := produce(req.GetStartSegment()); err != nil || e.Finish {
		return err
	}
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case c := <-commands:
			switch cmd := c.GetCommand().(type) {
			case *enginev1alpha.ControlSessionRequest_Seek:
				if err := produce(cmd.Seek.GetStartSegment()); err != nil {
					return err
				}
			case *enginev1alpha.ControlSessionRequest_Stop:
				return nil
			}
		}
	}
}

func (e *Engine) ControlSession(_ context.Context, req *enginev1alpha.ControlSessionRequest) (*enginev1alpha.ControlSessionResponse, error) {
	e.mu.Lock()
	commands, ok := e.sessions[req.GetSessionId()]
	switch c := req.GetCommand().(type) {
	case *enginev1alpha.ControlSessionRequest_Seek:
		e.Commands = append(e.Commands, fmt.Sprintf("seek %d", c.Seek.GetStartSegment()))
	case *enginev1alpha.ControlSessionRequest_Heartbeat:
		e.Commands = append(e.Commands, "heartbeat")
	case *enginev1alpha.ControlSessionRequest_Stop:
		e.Commands = append(e.Commands, "stop")
	}
	e.mu.Unlock()
	if !ok {
		return nil, status.Error(codes.NotFound, "no such session")
	}
	commands <- req
	return &enginev1alpha.ControlSessionResponse{}, nil
}
