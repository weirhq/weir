// Package artwork fetches item pictures on first request, caches them under
// the data directory, and serves resized copies.
package artwork

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // decode WebP artwork
	"google.golang.org/grpc"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/access"
	"github.com/weirhq/weir/server/internal/media"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// Prefix is where pictures are served: /media/artwork/<item>/<kind>.
const Prefix = "/media/artwork/"

const maxImageBytes = 20 << 20

// widths are the sizes served; a request rounds up to the next one.
var widths = []int{160, 320, 480, 780, 1280, 1920}

var kinds = map[string]bool{"poster": true, "backdrop": true, "logo": true, "thumb": true}

// Pictures copies pictures embedded in media files, such as an album's
// cover art in its tracks. The engine does it.
type Pictures interface {
	ExtractPicture(ctx context.Context, in *enginev1alpha.ExtractPictureRequest, opts ...grpc.CallOption) (*enginev1alpha.ExtractPictureResponse, error)
}

// Server fetches, caches and serves artwork.
type Server struct {
	store    *store.Store
	signer   *media.Signer
	dir      string
	http     *http.Client
	pictures Pictures

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewServer(st *store.Store, signer *media.Signer, dataDir string, pictures Pictures) *Server {
	return &Server{
		store: st, signer: signer, dir: filepath.Join(dataDir, "artwork"),
		http:     &http.Client{Timeout: 30 * time.Second},
		pictures: pictures,
		locks:    map[string]*sync.Mutex{},
	}
}

// lock serialises work on one picture, so concurrent requests don't fetch
// or resize it twice.
func (s *Server) lock(key string) func() {
	s.mu.Lock()
	l, ok := s.locks[key]
	if !ok {
		l = &sync.Mutex{}
		s.locks[key] = l
	}
	s.mu.Unlock()
	l.Lock()
	return l.Unlock
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, err := s.signer.Verify(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	idPart, kind, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, Prefix), "/")
	itemID, err := uuid.Parse(idPart)
	if err != nil || !kinds[kind] {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	item, err := s.store.GetItem(ctx, itemID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	caller, err := access.LoadUser(ctx, s.store, user)
	if err != nil || !caller.In(item.LibraryID).View {
		http.NotFound(w, r)
		return
	}
	width, _ := strconv.Atoi(r.URL.Query().Get("w"))
	path, hash, err := s.file(ctx, itemID, kind, width)
	if err != nil {
		slog.DebugContext(ctx, "no artwork", "item", itemID, "kind", kind, "err", err)
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("ETag", fmt.Sprintf("%q", hash+"-"+strconv.Itoa(width)))
	if strings.HasSuffix(path, ".png") {
		w.Header().Set("Content-Type", "image/png")
	} else {
		w.Header().Set("Content-Type", "image/jpeg")
	}
	http.ServeContent(w, r, "", time.Time{}, f)
}

// file returns the cached picture at the requested width, fetching and
// resizing it first if needed.
func (s *Server) file(ctx context.Context, item uuid.UUID, kind string, width int) (string, string, error) {
	defer s.lock(item.String() + "/" + kind)()
	original, hash, err := s.original(ctx, item, kind)
	if err != nil {
		return "", "", err
	}
	target := 0
	for _, w := range widths {
		if width > 0 && w >= width {
			target = w
			break
		}
	}
	if target == 0 {
		return original, hash, nil
	}
	ext := filepath.Ext(original)
	if ext != ".png" {
		ext = ".jpg"
	}
	resized := filepath.Join(filepath.Dir(original), fmt.Sprintf("%s-w%d%s", hash, target, ext))
	if _, err := os.Stat(resized); err == nil {
		return resized, hash, nil
	}
	img, err := decodeFile(original)
	if err != nil {
		return "", "", err
	}
	if img.Bounds().Dx() <= target {
		return original, hash, nil
	}
	b := img.Bounds()
	height := b.Dy() * target / b.Dx()
	dst := image.NewRGBA(image.Rect(0, 0, target, height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	if err := writeImage(resized, dst, ext); err != nil {
		return "", "", err
	}
	return resized, hash, nil
}

// smallEmbedded is the width below which an embedded cover gives way to a
// picture at least twice as wide from a source further down, such as the
// Cover Art Archive's: taggers often embed covers of 500px or so.
const smallEmbedded = 1000

// original returns the full-size cached picture, from the best source that
// works.
func (s *Server) original(ctx context.Context, item uuid.UUID, kind string) (string, string, error) {
	candidates, err := s.store.ArtworkCandidates(ctx, dbgen.ArtworkCandidatesParams{ItemID: item, Kind: kind})
	if err != nil {
		return "", "", err
	}
	dir := filepath.Join(s.dir, item.String())
	var errs []error
	for i, c := range candidates {
		pic, err := s.load(ctx, dir, c)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if c.Source == "embedded" && pic.width < smallEmbedded {
			for _, alt := range candidates[i+1:] {
				if larger, err := s.load(ctx, dir, alt); err == nil && larger.width >= 2*pic.width {
					return larger.path, larger.hash, nil
				}
			}
		}
		return pic.path, pic.hash, nil
	}
	if len(errs) == 0 {
		return "", "", errors.New("no artwork")
	}
	return "", "", errors.Join(errs...)
}

type picture struct {
	path, hash string
	width      int
}

// load returns one source's picture from the cache, fetching and caching it
// first if needed, and records its size.
func (s *Server) load(ctx context.Context, dir string, c dbgen.Artwork) (picture, error) {
	if c.Hash != nil && c.Width != nil {
		if matches, _ := filepath.Glob(filepath.Join(dir, *c.Hash+".*")); len(matches) > 0 {
			return picture{matches[0], *c.Hash, int(*c.Width)}, nil
		}
	}
	data, err := s.fetch(ctx, c.Source, c.Location)
	if err != nil {
		return picture{}, fmt.Errorf("%s: %w", c.Source, err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return picture{}, fmt.Errorf("%s: not an image: %w", c.Source, err)
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:16])
	ext := ".jpg"
	if format == "png" {
		ext = ".png"
	}
	path := filepath.Join(dir, hash+ext)
	if format == "jpeg" || format == "png" {
		err = writeFile(path, data)
	} else {
		// WebP and others are stored as JPEG, which every client shows.
		var img image.Image
		if img, _, err = image.Decode(bytes.NewReader(data)); err == nil {
			err = writeImage(path, img, ".jpg")
		}
	}
	if err != nil {
		return picture{}, err
	}
	if err := s.store.SetArtworkCache(ctx, dbgen.SetArtworkCacheParams{
		ItemID: c.ItemID, Kind: c.Kind, Source: c.Source, Hash: &hash, Width: ptr(int32(cfg.Width)), Height: ptr(int32(cfg.Height)),
	}); err != nil {
		return picture{}, err
	}
	return picture{path, hash, cfg.Width}, nil
}

func (s *Server) fetch(ctx context.Context, source, location string) ([]byte, error) {
	if source == "embedded" {
		return s.embedded(ctx, location)
	}
	if filepath.IsAbs(location) {
		f, err := os.Open(location)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(io.LimitReader(f, maxImageBytes))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, location, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxImageBytes))
}

// embedded copies a picture out of its media file through the engine. Its
// location is the file's path and the picture's stream index, "path#index".
func (s *Server) embedded(ctx context.Context, location string) ([]byte, error) {
	at := strings.LastIndexByte(location, '#')
	if at < 0 {
		return nil, fmt.Errorf("embedded picture %q isn't path#index", location)
	}
	index, err := strconv.ParseUint(location[at+1:], 10, 32)
	if err != nil {
		return nil, fmt.Errorf("embedded picture %q isn't path#index", location)
	}
	if s.pictures == nil {
		return nil, errors.New("no engine to read embedded pictures")
	}
	resp, err := s.pictures.ExtractPicture(ctx,
		&enginev1alpha.ExtractPictureRequest{Path: location[:at], Index: uint32(index)},
		// gRPC's default 4 MB is less than a large cover can be.
		grpc.MaxCallRecvMsgSize(maxImageBytes+64<<10))
	if err != nil {
		return nil, err
	}
	return resp.GetData(), nil
}

func decodeFile(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

// writeImage encodes img as PNG (keeping transparency, for logos) or JPEG.
func writeImage(path string, img image.Image, ext string) error {
	var buf bytes.Buffer
	var err error
	if ext == ".png" {
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85})
	}
	if err != nil {
		return err
	}
	return writeFile(path, buf.Bytes())
}

// writeFile writes atomically, so a reader never sees half a picture.
func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func ptr[T any](v T) *T { return &v }
