package metadata

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

const (
	musicBrainzAPI = "https://musicbrainz.org/ws/2"
	coverArtAPI    = "https://coverartarchive.org"
	// Search results scoring lower than this are someone else's.
	minScore = 90
)

// MusicBrainz looks up artists and albums. Its rules allow one request a
// second and require contact details in the User-Agent.
type MusicBrainz struct {
	userAgent string
	api       string
	coverArt  string
	http      *http.Client
	limit     *rate.Limiter
}

func NewMusicBrainz(contact, version string) *MusicBrainz {
	return &MusicBrainz{
		userAgent: "Weir/" + version + " ( " + contact + " )",
		api:       musicBrainzAPI,
		coverArt:  coverArtAPI,
		http:      &http.Client{Timeout: 30 * time.Second},
		limit:     rate.NewLimiter(1, 1),
	}
}

func (c *MusicBrainz) get(ctx context.Context, path string, q url.Values, out any) error {
	if err := c.limit.Wait(ctx); err != nil {
		return err
	}
	if q == nil {
		q = url.Values{}
	}
	q.Set("fmt", "json")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")
	return getJSON(ctx, c.http, req, out)
}

type mbGenre struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// topGenres keeps the five genres the most people voted for.
func topGenres(genres []mbGenre) []string {
	sort.SliceStable(genres, func(i, j int) bool { return genres[i].Count > genres[j].Count })
	var names []string
	for i, g := range genres {
		if i == 5 {
			break
		}
		names = append(names, g.Name)
	}
	return names
}

// Artist finds an artist by MusicBrainz id, else by name.
func (c *MusicBrainz) Artist(ctx context.Context, name, mbid string) (Record, error) {
	if mbid == "" {
		var search struct {
			Artists []struct {
				ID    string `json:"id"`
				Score int    `json:"score"`
			} `json:"artists"`
		}
		q := url.Values{"query": {"artist:" + luceneQuote(name)}, "limit": {"5"}}
		if err := c.get(ctx, "/artist", q, &search); err != nil {
			return Record{}, err
		}
		if len(search.Artists) == 0 || search.Artists[0].Score < minScore {
			return Record{}, errNotFound
		}
		mbid = search.Artists[0].ID
	}
	var a struct {
		ID     string    `json:"id"`
		Name   string    `json:"name"`
		Genres []mbGenre `json:"genres"`
	}
	if err := c.get(ctx, "/artist/"+url.PathEscape(mbid), url.Values{"inc": {"genres"}}, &a); err != nil {
		return Record{}, err
	}
	return Record{
		Title:       a.Name,
		Genres:      topGenres(a.Genres),
		ExternalIDs: map[string]string{"musicbrainz": a.ID},
	}, nil
}

// Album finds a release group by MusicBrainz id, else by title and artist.
// Searches prefer albums: a title track's single often scores as high.
func (c *MusicBrainz) Album(ctx context.Context, title, artist, mbid string) (Record, []Art, error) {
	if mbid == "" {
		var search struct {
			ReleaseGroups []struct {
				ID          string `json:"id"`
				Score       int    `json:"score"`
				PrimaryType string `json:"primary-type"`
			} `json:"release-groups"`
		}
		query := "releasegroup:" + luceneQuote(title)
		if artist != "" {
			query += " AND artist:" + luceneQuote(artist)
		}
		if err := c.get(ctx, "/release-group", url.Values{"query": {query}, "limit": {"5"}}, &search); err != nil {
			return Record{}, nil, err
		}
		best := -1
		for i, rg := range search.ReleaseGroups {
			if rg.Score < minScore {
				continue
			}
			if best == -1 || rg.PrimaryType == "Album" && search.ReleaseGroups[best].PrimaryType != "Album" {
				best = i
			}
		}
		if best == -1 {
			return Record{}, nil, errNotFound
		}
		mbid = search.ReleaseGroups[best].ID
	}
	var rg struct {
		ID               string    `json:"id"`
		Title            string    `json:"title"`
		FirstReleaseDate string    `json:"first-release-date"`
		Genres           []mbGenre `json:"genres"`
	}
	if err := c.get(ctx, "/release-group/"+url.PathEscape(mbid), url.Values{"inc": {"genres"}}, &rg); err != nil {
		return Record{}, nil, err
	}
	r := Record{
		Title:       rg.Title,
		Genres:      topGenres(rg.Genres),
		ExternalIDs: map[string]string{"musicbrainz": rg.ID},
	}
	r.ReleaseDate, r.Year = parseDate(rg.FirstReleaseDate)
	// The Cover Art Archive redirects to the front cover, if it has one.
	art := []Art{{Kind: "poster", Source: SourceCoverArtArchive, Location: c.coverArt + "/release-group/" + rg.ID + "/front"}}
	return r, art, nil
}

// luceneQuote quotes a value for a MusicBrainz search.
func luceneQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}
