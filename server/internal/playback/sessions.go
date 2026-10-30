package playback

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/media"
)

// SessionPrefix is where session media is served:
// /media/sessions/<id>/index.m3u8, init.mp4 and <n>.m4s.
const SessionPrefix = "/media/sessions/"

const (
	segmentLength    = 6 * time.Second
	heartbeatTimeout = 30 * time.Second
	reapEvery        = 5 * time.Second
	// How long a request waits for the engine to write a segment.
	segmentWait = 20 * time.Second
	// A request this many segments past the encoder seeks rather than waits.
	seekAhead = 4
	// Session links outlive the media by this much, for pauses.
	sessionGrace = 6 * time.Hour
)

var (
	errNoSession = errors.New("no such session")
	// ErrBusy means the engine is running as many sessions as it allows.
	ErrBusy = errors.New("the server is busy with other playback")
)

// Sessions runs playback sessions on the engine and serves their HLS.
type Sessions struct {
	engine enginev1alpha.EngineClient
	root   string
	signer *media.Signer
	now    func() time.Time

	mu   sync.Mutex
	byID map[uuid.UUID]*session
}

func NewSessions(engine enginev1alpha.EngineClient, segmentRoot string, signer *media.Signer) *Sessions {
	return &Sessions{engine: engine, root: segmentRoot, signer: signer, now: time.Now, byID: map[uuid.UUID]*session{}}
}

type segment struct {
	path     string
	duration time.Duration
}

type session struct {
	id, user uuid.UUID
	// A re-encoded video has segments of known length, so its playlist
	// lists the whole film up front and a jump ahead seeks the engine.
	vod      bool
	duration time.Duration
	dir      string
	cancel   context.CancelFunc

	mu            sync.Mutex
	changed       chan struct{}
	init          string
	segments      map[uint32]segment
	head, next    uint32 // the current engine run started at head; next is one past its newest segment
	finished      bool
	err           error
	lastHeartbeat time.Time
}

// broadcast wakes everything waiting for a change. Call with mu held.
func (s *session) broadcast() {
	close(s.changed)
	s.changed = make(chan struct{})
}

// Start begins a session for the file and returns its id and the signed
// playlist URL.
func (m *Sessions) Start(ctx context.Context, userID uuid.UUID, file string, duration time.Duration, out *enginev1alpha.OutputProfile, vod bool) (uuid.UUID, string, error) {
	id := uuid.Must(uuid.NewV7())
	dir := filepath.Join(m.root, id.String())
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return uuid.Nil, "", err
	}
	sctx, cancel := context.WithCancel(context.Background())
	stream, err := m.engine.StartSession(sctx, &enginev1alpha.StartSessionRequest{
		SessionId:       id.String(),
		Path:            file,
		Output:          out,
		SegmentDuration: durationpb.New(segmentLength),
		OutputDir:       dir,
	})
	if err == nil {
		err = accepted(stream)
	}
	if err != nil {
		cancel()
		_ = os.RemoveAll(dir)
		if status.Code(err) == codes.ResourceExhausted {
			return uuid.Nil, "", ErrBusy
		}
		return uuid.Nil, "", fmt.Errorf("start engine session: %w", err)
	}
	s := &session{
		id: id, user: userID, vod: vod, duration: duration, dir: dir, cancel: cancel,
		changed: make(chan struct{}), segments: map[uint32]segment{}, lastHeartbeat: m.now(),
	}
	m.mu.Lock()
	m.byID[id] = s
	m.mu.Unlock()
	go s.consume(stream)

	scope := SessionPrefix + id.String() + "/"
	url := scope + "index.m3u8?" + m.signer.SignScope(scope, userID, duration+sessionGrace)
	return id, url, nil
}

// accepted waits for the engine's answer to StartSession. An engine that
// refuses sends no headers, only a status, which Recv returns.
func accepted(stream enginev1alpha.Engine_StartSessionClient) error {
	md, err := stream.Header()
	if err != nil {
		return err
	}
	if md == nil {
		_, err = stream.Recv()
		if err == nil || err == io.EOF {
			return errors.New("the engine ended the session before it started")
		}
		return err
	}
	return nil
}

// consume records the engine's events until its stream ends.
func (s *session) consume(stream enginev1alpha.Engine_StartSessionClient) {
	for {
		resp, err := stream.Recv()
		s.mu.Lock()
		if err != nil {
			if err != io.EOF && status.Code(err) != codes.Canceled && s.err == nil && !s.finished {
				s.err = err
			}
			s.finished = s.finished || s.err == nil
			s.broadcast()
			s.mu.Unlock()
			return
		}
		switch e := resp.GetEvent().GetEvent().(type) {
		case *enginev1alpha.SessionEvent_Ready:
			s.init = e.Ready.GetInitSegment()
		case *enginev1alpha.SessionEvent_Segment:
			seg := e.Segment
			s.segments[seg.GetIndex()] = segment{path: seg.GetPath(), duration: seg.GetDuration().AsDuration()}
			s.next = max(s.next, seg.GetIndex()+1)
		case *enginev1alpha.SessionEvent_Finished:
			s.finished = true
		case *enginev1alpha.SessionEvent_Failed:
			s.err = errors.New(e.Failed.GetMessage())
			slog.Warn("playback session failed", "session", s.id, "err", s.err)
		}
		s.broadcast()
		s.mu.Unlock()
	}
}

func (m *Sessions) get(id, user uuid.UUID) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.byID[id]
	if !ok || s.user != user {
		return nil, errNoSession
	}
	return s, nil
}

// Heartbeat keeps a session alive, here and on the engine.
func (m *Sessions) Heartbeat(ctx context.Context, id, user uuid.UUID) error {
	s, err := m.get(id, user)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.lastHeartbeat = m.now()
	s.mu.Unlock()
	_, err = m.engine.ControlSession(ctx, &enginev1alpha.ControlSessionRequest{
		SessionId: id.String(), Command: &enginev1alpha.ControlSessionRequest_Heartbeat{Heartbeat: &enginev1alpha.Heartbeat{}},
	})
	// A session the engine has finished writing is still watchable.
	if status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

// Stop ends a session and deletes its segments.
func (m *Sessions) Stop(ctx context.Context, id, user uuid.UUID) error {
	if _, err := m.get(id, user); err != nil {
		return err
	}
	m.end(ctx, id)
	return nil
}

func (m *Sessions) end(ctx context.Context, id uuid.UUID) {
	m.mu.Lock()
	s, ok := m.byID[id]
	delete(m.byID, id)
	m.mu.Unlock()
	if !ok {
		return
	}
	_, _ = m.engine.ControlSession(ctx, &enginev1alpha.ControlSessionRequest{
		SessionId: id.String(), Command: &enginev1alpha.ControlSessionRequest_Stop{Stop: &enginev1alpha.Stop{}},
	})
	s.cancel()
	if err := os.RemoveAll(s.dir); err != nil {
		slog.Warn("remove session segments", "dir", s.dir, "err", err)
	}
}

// Run ends sessions whose client stopped sending heartbeats, until ctx is
// done, then ends the rest.
func (m *Sessions) Run(ctx context.Context) {
	ticker := time.NewTicker(reapEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			m.mu.Lock()
			var ids []uuid.UUID
			for id := range m.byID {
				ids = append(ids, id)
			}
			m.mu.Unlock()
			for _, id := range ids {
				m.end(context.Background(), id)
			}
			return
		case <-ticker.C:
			m.reap(ctx)
		}
	}
}

func (m *Sessions) reap(ctx context.Context) {
	cutoff := m.now().Add(-heartbeatTimeout)
	m.mu.Lock()
	var stale []uuid.UUID
	for id, s := range m.byID {
		s.mu.Lock()
		if s.lastHeartbeat.Before(cutoff) {
			stale = append(stale, id)
		}
		s.mu.Unlock()
	}
	m.mu.Unlock()
	for _, id := range stale {
		slog.Info("ending playback session without heartbeats", "session", id)
		m.end(ctx, id)
	}
}

// Handler serves session playlists and segments at signed URLs.
func (m *Sessions) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := m.signer.Verify(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		idPart, name, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, SessionPrefix), "/")
		id, err := uuid.Parse(idPart)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		s, err := m.get(id, user)
		if err != nil {
			http.Error(w, "this playback session has ended", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		switch {
		case name == "index.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, s.playlist(r.URL.RawQuery))
		case name == "init.mp4":
			path, err := s.wait(r.Context(), func() (string, bool) { return s.init, s.init != "" })
			m.serve(w, r, path, err)
		case strings.HasSuffix(name, ".m4s"):
			n, err := strconv.ParseUint(strings.TrimSuffix(name, ".m4s"), 10, 32)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			path, err := m.segment(r.Context(), s, uint32(n))
			m.serve(w, r, path, err)
		default:
			http.NotFound(w, r)
		}
	})
}

func (m *Sessions) serve(w http.ResponseWriter, r *http.Request, path string, err error) {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		http.Error(w, "the server is still preparing this part", http.StatusGatewayTimeout)
	case err != nil:
		http.Error(w, err.Error(), http.StatusNotFound)
	default:
		w.Header().Set("Content-Type", "video/mp4")
		http.ServeFile(w, r, path)
	}
}

// segment returns segment n's file, seeking the engine first when n is far
// from where it is encoding.
func (m *Sessions) segment(ctx context.Context, s *session, n uint32) (string, error) {
	s.mu.Lock()
	_, have := s.segments[n]
	needSeek := !have && s.vod && !s.finished && (n < s.head || n > s.next+seekAhead)
	if needSeek {
		s.head, s.next = n, n
	}
	s.mu.Unlock()
	if needSeek {
		_, err := m.engine.ControlSession(ctx, &enginev1alpha.ControlSessionRequest{
			SessionId: s.id.String(),
			Command: &enginev1alpha.ControlSessionRequest_Seek{Seek: &enginev1alpha.Seek{
				Offset: durationpb.New(time.Duration(n) * segmentLength), StartSegment: n,
			}},
		})
		if err != nil {
			return "", fmt.Errorf("seek: %w", err)
		}
	}
	return s.wait(ctx, func() (string, bool) {
		seg, ok := s.segments[n]
		return seg.path, ok
	})
}

// wait blocks until ready reports a path, the session ends, or segmentWait
// passes. ready runs with s.mu held.
func (s *session) wait(ctx context.Context, ready func() (string, bool)) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, segmentWait)
	defer cancel()
	for {
		s.mu.Lock()
		path, ok := ready()
		ended, failure, changed := s.finished, s.err, s.changed
		s.mu.Unlock()
		switch {
		case ok:
			return path, nil
		case failure != nil:
			return "", fmt.Errorf("playback failed: %w", failure)
		case ended:
			return "", errors.New("past the end of the media")
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
}

// playlist renders the session's HLS playlist, signing each URI with query.
func (s *session) playlist(query string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var b strings.Builder
	type entry struct {
		index    uint32
		duration time.Duration
	}
	var entries []entry
	target := segmentLength
	ended := s.finished
	if s.vod {
		count := uint32(math.Ceil(s.duration.Seconds() / segmentLength.Seconds()))
		for i := range count {
			d := min(segmentLength, s.duration-time.Duration(i)*segmentLength)
			entries = append(entries, entry{i, d})
		}
		ended = true
	} else {
		// Copied video splits on its own keyframes: list what exists, in
		// order, and let the player reload.
		for i := uint32(0); ; i++ {
			seg, ok := s.segments[i]
			if !ok {
				break
			}
			entries = append(entries, entry{i, seg.duration})
			target = max(target, seg.duration)
		}
		// Keep the target stable across reloads where possible.
		target = max(target, 2*segmentLength)
	}

	kind := "EVENT"
	if s.vod {
		kind = "VOD"
	}
	fmt.Fprintf(&b, "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:%d\n#EXT-X-PLAYLIST-TYPE:%s\n", int(math.Ceil(target.Seconds())), kind)
	fmt.Fprintf(&b, "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI=\"init.mp4?%s\"\n", query)
	for _, e := range entries {
		fmt.Fprintf(&b, "#EXTINF:%.3f,\n%d.m4s?%s\n", e.duration.Seconds(), e.index, query)
	}
	if ended {
		b.WriteString("#EXT-X-ENDLIST\n")
	}
	return b.String()
}
