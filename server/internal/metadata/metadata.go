// Package metadata looks up titles, overviews, people and artwork for
// scanned items, from NFO sidecars, files next to the media, TMDB and
// MusicBrainz. Each source writes its own rows; the resolved_metadata view
// picks per field.
package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// Sources, as stored in metadata.source and artwork.source.
const (
	SourceNFO             = "nfo"
	SourceTMDB            = "tmdb"
	SourceMusicBrainz     = "musicbrainz"
	SourceLocal           = "local"
	SourceCoverArtArchive = "coverartarchive"
)

// Record is what one source knows about one item. Zero values are unknown.
type Record struct {
	Title, OriginalTitle, Overview, Tagline, ContentRating string
	Year, RuntimeMinutes                                   int
	ReleaseDate                                            time.Time
	Rating                                                 float32
	Genres                                                 []string
	Cast                                                   []Person
	ExternalIDs                                            map[string]string
}

type Person struct {
	Name string `json:"name"`
	Role string `json:"role,omitempty"`
}

// Art is a picture of an item: a file path for local art, else a URL.
type Art struct {
	Kind     string // poster, backdrop, logo or thumb
	Source   string
	Location string
}

var (
	errNotFound = errors.New("not found")
	// ErrUnauthorized means a provider rejected its key; the refresh stops
	// using it.
	ErrUnauthorized = errors.New("provider rejected the configured key")
)

func saveRecord(ctx context.Context, q *dbgen.Queries, itemID uuid.UUID, source string, r Record) error {
	if r.Genres == nil {
		r.Genres = []string{}
	}
	if r.Cast == nil {
		r.Cast = []Person{}
	}
	if r.ExternalIDs == nil {
		r.ExternalIDs = map[string]string{}
	}
	cast, err := json.Marshal(r.Cast)
	if err != nil {
		return err
	}
	ids, err := json.Marshal(r.ExternalIDs)
	if err != nil {
		return err
	}
	return q.UpsertMetadata(ctx, dbgen.UpsertMetadataParams{
		ItemID:         itemID,
		Source:         source,
		Title:          optString(r.Title),
		OriginalTitle:  optString(r.OriginalTitle),
		Overview:       optString(r.Overview),
		Tagline:        optString(r.Tagline),
		Year:           optInt(r.Year),
		ReleaseDate:    optTime(r.ReleaseDate),
		RuntimeMinutes: optInt(r.RuntimeMinutes),
		Rating:         optFloat(r.Rating),
		ContentRating:  optString(r.ContentRating),
		Genres:         r.Genres,
		CastMembers:    cast,
		ExternalIds:    ids,
	})
}

func saveArt(ctx context.Context, q *dbgen.Queries, itemID uuid.UUID, art []Art) error {
	for _, a := range art {
		if err := q.UpsertArtwork(ctx, dbgen.UpsertArtworkParams{ItemID: itemID, Kind: a.Kind, Source: a.Source, Location: a.Location}); err != nil {
			return err
		}
	}
	return nil
}

// getJSON sends req and decodes a JSON reply into out, retrying a few times
// when the provider asks it to slow down.
func getJSON(ctx context.Context, client *http.Client, req *http.Request, out any) error {
	const attempts = 4
	for attempt := 1; ; attempt++ {
		resp, err := client.Do(req.Clone(ctx))
		if err != nil {
			return err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if err != nil {
			return err
		}
		switch {
		case resp.StatusCode == http.StatusOK:
			return json.Unmarshal(body, out)
		case resp.StatusCode == http.StatusNotFound:
			return errNotFound
		case resp.StatusCode == http.StatusUnauthorized:
			return ErrUnauthorized
		case (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable) && attempt < attempts:
			wait := time.Duration(attempt) * 2 * time.Second
			if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil {
				wait = time.Duration(s) * time.Second
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		default:
			return fmt.Errorf("%s %s: %s", req.Method, req.URL.Redacted(), resp.Status)
		}
	}
}

// parseDate reads "2016-11-11" or a bare "2016".
func parseDate(s string) (date time.Time, year int) {
	if t, err := time.Parse(time.DateOnly, s); err == nil {
		return t, t.Year()
	}
	if len(s) >= 4 {
		year, _ = strconv.Atoi(s[:4])
	}
	return time.Time{}, year
}

func optString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func optInt(n int) *int32 {
	if n == 0 {
		return nil
	}
	v := int32(n)
	return &v
}

func optFloat(f float32) *float32 {
	if f == 0 {
		return nil
	}
	return &f
}

func optTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}
