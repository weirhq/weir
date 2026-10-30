// Package media serves media files at signed, time-limited URLs, so a
// <video> element or player can fetch them without an API client.
package media

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// FilePrefix is where files are served: /media/files/<file id>.
const FilePrefix = "/media/files/"

// Signer signs and checks media URLs with a key derived from the server's
// identity key, so no extra secret needs storing.
type Signer struct {
	key []byte
	now func() time.Time
}

func NewSigner(serverKey ed25519.PrivateKey) *Signer {
	k := sha256.Sum256(append([]byte("weir/media-url/v1\x00"), serverKey.Seed()...))
	return &Signer{key: k[:], now: time.Now}
}

// Sign returns path with the user and an expiry signed into its query.
func (s *Signer) Sign(path string, userID uuid.UUID, ttl time.Duration) string {
	exp := strconv.FormatInt(s.now().Add(ttl).Unix(), 10)
	q := url.Values{"u": {userID.String()}, "exp": {exp}, "sig": {s.mac(path, userID.String(), exp)}}
	return path + "?" + q.Encode()
}

var errBadSignature = errors.New("invalid or expired media URL")

// Verify checks a request's signature and expiry, and returns the user it
// was signed for.
func (s *Signer) Verify(r *http.Request) (uuid.UUID, error) {
	q := r.URL.Query()
	user, exp, sig := q.Get("u"), q.Get("exp"), q.Get("sig")
	if !hmac.Equal([]byte(sig), []byte(s.mac(r.URL.Path, user, exp))) {
		return uuid.Nil, errBadSignature
	}
	expires, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || s.now().Unix() > expires {
		return uuid.Nil, errBadSignature
	}
	return uuid.Parse(user)
}

func (s *Signer) mac(path, user, exp string) string {
	m := hmac.New(sha256.New, s.key)
	fmt.Fprintf(m, "%s\x00%s\x00%s", path, user, exp)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// FileURL is the signed URL of a media file, valid for ttl.
func (s *Signer) FileURL(fileID, userID uuid.UUID, ttl time.Duration) string {
	return s.Sign(FilePrefix+fileID.String(), userID, ttl)
}

// Files looks up a media file's path by id.
type Files interface {
	GetMediaFilePath(ctx context.Context, id uuid.UUID) (string, error)
}

// Handler serves media files at signed URLs, with range requests.
func Handler(signer *Signer, files Files) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if _, err := signer.Verify(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		id, err := uuid.Parse(strings.TrimPrefix(r.URL.Path, FilePrefix))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		path, err := files.GetMediaFilePath(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "look up media file", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		f, err := os.Open(path)
		if err != nil {
			slog.WarnContext(r.Context(), "media file unavailable", "path", path, "err", err)
			http.Error(w, "file unavailable", http.StatusNotFound)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if t := mime.TypeByExtension(filepath.Ext(path)); t != "" {
			w.Header().Set("Content-Type", t)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		// The URL is per user and expires; nothing should cache it publicly.
		w.Header().Set("Cache-Control", "private, no-transform")
		http.ServeContent(w, r, "", info.ModTime(), f)
	})
}
