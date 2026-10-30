package metadata

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeTMDB answers the endpoints the client uses, in the shapes TMDB's API
// reference documents.
func fakeTMDB(t *testing.T, key string) *httptest.Server {
	t.Helper()
	routes := map[string]string{
		"/search/movie":   `{"page":1,"results":[{"id":11,"title":"Arrival","release_date":"1996-05-31"},{"id":329865,"title":"Arrival","release_date":"2016-11-10"}]}`,
		"/find/tt2543164": `{"movie_results":[{"id":329865}],"tv_results":[]}`,
		"/movie/329865": `{"id":329865,"imdb_id":"tt2543164","title":"Arrival","original_title":"Arrival",
			"overview":"Taking place after alien crafts land around the world...","tagline":"Why are they here?",
			"release_date":"2016-11-10","runtime":116,"vote_average":7.6,"vote_count":19000,
			"genres":[{"id":18,"name":"Drama"},{"id":878,"name":"Science Fiction"}],
			"poster_path":"/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg","backdrop_path":"/yIZ1xendyqKvY3FGeeUYUd5X9Mm.jpg",
			"credits":{"cast":[{"name":"Amy Adams","character":"Louise Banks"},{"name":"Jeremy Renner","character":"Ian Donnelly"}]},
			"release_dates":{"results":[{"iso_3166_1":"GB","release_dates":[{"certification":"12A"}]},{"iso_3166_1":"US","release_dates":[{"certification":""},{"certification":"PG-13"}]}]}}`,
		"/search/tv": `{"page":1,"results":[{"id":95396,"name":"Severance","first_air_date":"2022-02-17"}]}`,
		"/tv/95396": `{"id":95396,"name":"Severance","original_name":"Severance","overview":"Mark leads a team of office workers...",
			"first_air_date":"2022-02-17","vote_average":8.4,"vote_count":2000,"genres":[{"name":"Drama"},{"name":"Mystery"}],
			"poster_path":"/sev.jpg","backdrop_path":"/sevbg.jpg","credits":{"cast":[{"name":"Adam Scott","character":"Mark Scout"}]},
			"external_ids":{"imdb_id":"tt11280740","tvdb_id":371980},
			"content_ratings":{"results":[{"iso_3166_1":"US","rating":"TV-MA"}]}}`,
		"/tv/95396/season/1": `{"name":"Season 1","overview":"","air_date":"2022-02-17","poster_path":"/s1.jpg",
			"episodes":[{"episode_number":1,"name":"Good News About Hell","overview":"Mark is promoted.","air_date":"2022-02-17","runtime":57,"vote_average":8.1,"vote_count":90,"still_path":"/e1.jpg"},
			{"episode_number":2,"name":"Half Loop","air_date":"2022-02-17","runtime":53}]}`,
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authed := r.URL.Query().Get("api_key") == key || r.Header.Get("Authorization") == "Bearer "+key
		if !authed {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("language") != "en-GB" {
			t.Errorf("%s without language", r.URL.Path)
		}
		body, ok := routes[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write([]byte(body))
	}))
}

func testTMDB(t *testing.T, key string) *TMDB {
	srv := fakeTMDB(t, key)
	t.Cleanup(srv.Close)
	c := NewTMDB(key, "en-GB")
	c.api, c.images = srv.URL, "https://img.test"
	return c
}

func TestTMDBMovie(t *testing.T) {
	ctx := context.Background()
	for _, key := range []string{"v3key", "eyJhbGciOiJIUzI1NiJ9.v4token"} {
		c := testTMDB(t, key)
		r, art, err := c.Movie(ctx, "Arrival", 2016, nil)
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if r.ExternalIDs["tmdb"] != "329865" || r.ExternalIDs["imdb"] != "tt2543164" || r.Year != 2016 || r.OriginalTitle != "" {
			t.Errorf("record %+v", r)
		}
		if r.Rating != 7.6 || r.RuntimeMinutes != 116 || len(r.Genres) != 2 || r.Cast[0].Name != "Amy Adams" {
			t.Errorf("details %+v", r)
		}
		if len(art) != 2 || art[0].Location != "https://img.test/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg" {
			t.Errorf("art %v", art)
		}
		// en-GB picks the British certificate.
		if r.ContentRating != "12A" {
			t.Errorf("certification %q", r.ContentRating)
		}
	}
}

func TestTMDBMovieByIMDbIDAndMisses(t *testing.T) {
	ctx := context.Background()
	c := testTMDB(t, "k")
	if r, _, err := c.Movie(ctx, "ignored", 0, map[string]string{"imdb": "tt2543164"}); err != nil || r.Title != "Arrival" {
		t.Errorf("by imdb: %v %+v", err, r)
	}
	if _, _, err := c.Movie(ctx, "Arrival", 1950, nil); !errors.Is(err, errNotFound) {
		t.Errorf("year mismatch: %v", err)
	}
	bad := NewTMDB("wrong", "en-GB")
	bad.api = c.api
	if _, _, err := bad.Movie(ctx, "Arrival", 2016, nil); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("bad key: %v", err)
	}
}

func TestTMDBShowAndSeason(t *testing.T) {
	ctx := context.Background()
	c := testTMDB(t, "k")
	c.region = "US"
	r, _, id, err := c.Show(ctx, "Severance", 2022, nil)
	if err != nil {
		t.Fatal(err)
	}
	if id != "95396" || r.ExternalIDs["tvdb"] != "371980" || r.ContentRating != "TV-MA" || r.Cast[0].Role != "Mark Scout" {
		t.Errorf("show %s %+v", id, r)
	}
	season, art, episodes, err := c.Season(ctx, id, 1)
	if err != nil {
		t.Fatal(err)
	}
	if season.Title != "Season 1" || len(art) != 1 || len(episodes) != 2 {
		t.Errorf("season %+v %v %d", season, art, len(episodes))
	}
	if e := episodes[1]; e.Record.Title != "Good News About Hell" || e.Record.Rating != 8.1 || e.Art[0].Kind != "thumb" {
		t.Errorf("episode 1 %+v", e)
	}
	if e := episodes[2]; e.Record.Rating != 0 || e.Art != nil {
		t.Errorf("episode 2 has no votes or still: %+v", e)
	}
}

// fakeMusicBrainz serves the real responses in testdata/musicbrainz, after
// failing the first request with a 503 as MusicBrainz does when busy.
func fakeMusicBrainz(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	file := func(name string) []byte {
		b, err := os.ReadFile("testdata/musicbrainz/" + name)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if !strings.Contains(r.UserAgent(), "( ops@example.org )") || r.URL.Query().Get("fmt") != "json" {
			t.Errorf("request without contact or json: %s %s", r.UserAgent(), r.URL)
		}
		switch r.URL.Path {
		case "/artist":
			w.Write(file("artist-search.json"))
		case "/artist/4b585938-f271-45e2-b19a-91c634b5e396":
			w.Write(file("artist.json"))
		case "/release-group":
			if q := r.URL.Query().Get("query"); q != `releasegroup:"Hounds of Love" AND artist:"Kate Bush"` {
				t.Errorf("release-group query %q", q)
			}
			w.Write(file("release-group-search.json"))
		case "/release-group/017f2a37-a78f-3578-9611-fa40408e5d90":
			w.Write(file("release-group.json"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func testMusicBrainz(t *testing.T) *MusicBrainz {
	srv, _ := fakeMusicBrainz(t)
	c := NewMusicBrainz("ops@example.org", "test")
	c.api, c.coverArt = srv.URL, "https://caa.test"
	c.limit.SetLimit(1000)
	c.limit.SetBurst(1000)
	return c
}

func TestMusicBrainzArtist(t *testing.T) {
	r, err := testMusicBrainz(t).Artist(context.Background(), "Kate Bush", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.Title != "Kate Bush" || r.ExternalIDs["musicbrainz"] != "4b585938-f271-45e2-b19a-91c634b5e396" || len(r.Genres) == 0 {
		t.Errorf("artist %+v", r)
	}
}

func TestMusicBrainzAlbumPrefersTheAlbumOverTheSingle(t *testing.T) {
	r, art, err := testMusicBrainz(t).Album(context.Background(), "Hounds of Love", "Kate Bush", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.ExternalIDs["musicbrainz"] != "017f2a37-a78f-3578-9611-fa40408e5d90" || r.Year != 1985 || r.ReleaseDate.Month() != 7 {
		t.Errorf("album %+v", r)
	}
	if len(art) != 1 || art[0].Location != "https://caa.test/release-group/017f2a37-a78f-3578-9611-fa40408e5d90/front" {
		t.Errorf("art %v", art)
	}
}

func TestMusicBrainzByID(t *testing.T) {
	r, err := testMusicBrainz(t).Artist(context.Background(), "ignored", "4b585938-f271-45e2-b19a-91c634b5e396")
	if err != nil || r.Title != "Kate Bush" {
		t.Errorf("by id: %v %+v", err, r)
	}
}
