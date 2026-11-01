package media

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

// SubtitlePrefix is where text subtitles are served as WebVTT:
// /media/subtitles/<file id>/<stream index>.vtt.
const SubtitlePrefix = "/media/subtitles/"

// maxSubtitleBytes is more than any subtitle track needs; it lifts gRPC's
// 4 MB default.
const maxSubtitleBytes = 32 << 20

// Subtitles converts text subtitle streams to WebVTT. The engine does it.
type Subtitles interface {
	ExtractSubtitle(ctx context.Context, in *enginev1alpha.ExtractSubtitleRequest, opts ...grpc.CallOption) (*enginev1alpha.ExtractSubtitleResponse, error)
}

// SubtitleURL is the signed URL of a file's text subtitle stream as WebVTT,
// valid for ttl.
func (s *Signer) SubtitleURL(fileID uuid.UUID, index uint32, userID uuid.UUID, ttl time.Duration) string {
	return s.Sign(fmt.Sprintf("%s%s/%d.vtt", SubtitlePrefix, fileID, index), userID, ttl)
}

// SubtitleHandler serves text subtitles as WebVTT at signed URLs. The
// engine reads the whole file to convert a stream, so each conversion is
// kept under dir, named for the file as it was, until the file changes.
func SubtitleHandler(signer *Signer, files Files, engine Subtitles, dir string) http.Handler {
	var mu sync.Mutex
	locks := map[string]*sync.Mutex{}
	lock := func(key string) func() {
		mu.Lock()
		l, ok := locks[key]
		if !ok {
			l = &sync.Mutex{}
			locks[key] = l
		}
		mu.Unlock()
		l.Lock()
		return l.Unlock
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := signer.Verify(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		idPart, name, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, SubtitlePrefix), "/")
		id, err := uuid.Parse(idPart)
		indexPart, ok := strings.CutSuffix(name, ".vtt")
		index, convErr := strconv.ParseUint(indexPart, 10, 32)
		if err != nil || !ok || convErr != nil {
			http.NotFound(w, r)
			return
		}
		ctx := r.Context()
		path, err := files.GetMediaFilePath(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			slog.ErrorContext(ctx, "look up media file", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		info, err := os.Stat(path)
		if err != nil {
			http.Error(w, "file unavailable", http.StatusNotFound)
			return
		}
		key := fmt.Sprintf("%s-%d-%d-%d", id, index, info.Size(), info.ModTime().Unix())
		cached := filepath.Join(dir, key+".vtt")
		defer lock(key)()
		vtt, err := os.ReadFile(cached)
		if err != nil {
			resp, err := engine.ExtractSubtitle(ctx,
				&enginev1alpha.ExtractSubtitleRequest{Path: path, Index: uint32(index)},
				grpc.MaxCallRecvMsgSize(maxSubtitleBytes))
			if status.Code(err) == codes.NotFound {
				http.NotFound(w, r)
				return
			}
			if err != nil {
				slog.WarnContext(ctx, "extract subtitle", "path", path, "index", index, "err", err)
				http.Error(w, "subtitle unavailable", http.StatusBadGateway)
				return
			}
			vtt = []byte(resp.GetWebvtt())
			if err := os.MkdirAll(dir, 0o755); err == nil {
				_ = os.WriteFile(cached, vtt, 0o644)
			}
		}
		w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		_, _ = w.Write(vtt)
	})
}
