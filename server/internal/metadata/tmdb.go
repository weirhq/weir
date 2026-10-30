package metadata

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

const (
	tmdbAPI    = "https://api.themoviedb.org/3"
	tmdbImages = "https://image.tmdb.org/t/p/original"
	// Billing positions kept per film or show.
	maxCast = 20
)

// TMDB looks up films and shows on The Movie Database.
type TMDB struct {
	key      string
	language string
	region   string
	api      string
	images   string
	http     *http.Client
	limit    *rate.Limiter
}

// NewTMDB takes a v3 API key or a v4 read access token, and a BCP 47
// language such as "en-US" whose region picks content ratings.
func NewTMDB(key, language string) *TMDB {
	region := "US"
	if _, r, ok := strings.Cut(language, "-"); ok {
		region = strings.ToUpper(r)
	}
	return &TMDB{
		key: key, language: language, region: region,
		api: tmdbAPI, images: tmdbImages,
		http:  &http.Client{Timeout: 30 * time.Second},
		limit: rate.NewLimiter(20, 20),
	}
}

func (c *TMDB) get(ctx context.Context, path string, q url.Values, out any) error {
	if err := c.limit.Wait(ctx); err != nil {
		return err
	}
	if q == nil {
		q = url.Values{}
	}
	q.Set("language", c.language)
	// v4 read tokens are JWTs; v3 keys go in the query.
	bearer := strings.HasPrefix(c.key, "eyJ")
	if !bearer {
		q.Set("api_key", c.key)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	if bearer {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	req.Header.Set("Accept", "application/json")
	return getJSON(ctx, c.http, req, out)
}

type tmdbGenre struct {
	Name string `json:"name"`
}

type tmdbCredits struct {
	Cast []struct {
		Name      string `json:"name"`
		Character string `json:"character"`
	} `json:"cast"`
}

func (c tmdbCredits) people() []Person {
	var cast []Person
	for i, p := range c.Cast {
		if i == maxCast {
			break
		}
		cast = append(cast, Person{Name: p.Name, Role: p.Character})
	}
	return cast
}

func (c *TMDB) art(kind, path string) []Art {
	if path == "" {
		return nil
	}
	return []Art{{Kind: kind, Source: SourceTMDB, Location: c.images + path}}
}

// Movie finds a film by its TMDB or IMDb id, else by title and year.
func (c *TMDB) Movie(ctx context.Context, title string, year int, ids map[string]string) (Record, []Art, error) {
	id := ids["tmdb"]
	if id == "" && ids["imdb"] != "" {
		var found struct {
			MovieResults []struct {
				ID int `json:"id"`
			} `json:"movie_results"`
		}
		if err := c.get(ctx, "/find/"+url.PathEscape(ids["imdb"]), url.Values{"external_source": {"imdb_id"}}, &found); err != nil && err != errNotFound {
			return Record{}, nil, err
		}
		if len(found.MovieResults) > 0 {
			id = strconv.Itoa(found.MovieResults[0].ID)
		}
	}
	if id == "" {
		var search struct {
			Results []struct {
				ID          int    `json:"id"`
				ReleaseDate string `json:"release_date"`
			} `json:"results"`
		}
		q := url.Values{"query": {title}}
		if year != 0 {
			q.Set("year", strconv.Itoa(year))
		}
		if err := c.get(ctx, "/search/movie", q, &search); err != nil {
			return Record{}, nil, err
		}
		for _, r := range search.Results {
			if _, y := parseDate(r.ReleaseDate); year == 0 || abs(y-year) <= 1 {
				id = strconv.Itoa(r.ID)
				break
			}
		}
		if id == "" {
			return Record{}, nil, errNotFound
		}
	}

	var m struct {
		ID            int         `json:"id"`
		IMDbID        string      `json:"imdb_id"`
		Title         string      `json:"title"`
		OriginalTitle string      `json:"original_title"`
		Overview      string      `json:"overview"`
		Tagline       string      `json:"tagline"`
		ReleaseDate   string      `json:"release_date"`
		Runtime       int         `json:"runtime"`
		VoteAverage   float32     `json:"vote_average"`
		VoteCount     int         `json:"vote_count"`
		Genres        []tmdbGenre `json:"genres"`
		PosterPath    string      `json:"poster_path"`
		BackdropPath  string      `json:"backdrop_path"`
		Credits       tmdbCredits `json:"credits"`
		ReleaseDates  struct {
			Results []struct {
				Country      string `json:"iso_3166_1"`
				ReleaseDates []struct {
					Certification string `json:"certification"`
				} `json:"release_dates"`
			} `json:"results"`
		} `json:"release_dates"`
	}
	if err := c.get(ctx, "/movie/"+id, url.Values{"append_to_response": {"credits,release_dates"}}, &m); err != nil {
		return Record{}, nil, err
	}
	r := Record{
		Title: m.Title, Overview: m.Overview, Tagline: m.Tagline, RuntimeMinutes: m.Runtime,
		Cast:        m.Credits.people(),
		ExternalIDs: map[string]string{"tmdb": strconv.Itoa(m.ID)},
	}
	if m.OriginalTitle != m.Title {
		r.OriginalTitle = m.OriginalTitle
	}
	r.ReleaseDate, r.Year = parseDate(m.ReleaseDate)
	if m.VoteCount > 0 {
		r.Rating = m.VoteAverage
	}
	if m.IMDbID != "" {
		r.ExternalIDs["imdb"] = m.IMDbID
	}
	for _, g := range m.Genres {
		r.Genres = append(r.Genres, g.Name)
	}
	for _, rd := range m.ReleaseDates.Results {
		if rd.Country != c.region {
			continue
		}
		for _, d := range rd.ReleaseDates {
			if d.Certification != "" {
				r.ContentRating = d.Certification
				break
			}
		}
	}
	art := append(c.art("poster", m.PosterPath), c.art("backdrop", m.BackdropPath)...)
	return r, art, nil
}

// Show finds a series by its TMDB id, else by title and first-air year. It
// returns the TMDB id for Season.
func (c *TMDB) Show(ctx context.Context, title string, year int, ids map[string]string) (Record, []Art, string, error) {
	id := ids["tmdb"]
	if id == "" {
		var search struct {
			Results []struct {
				ID           int    `json:"id"`
				FirstAirDate string `json:"first_air_date"`
			} `json:"results"`
		}
		q := url.Values{"query": {title}}
		if year != 0 {
			q.Set("first_air_date_year", strconv.Itoa(year))
		}
		if err := c.get(ctx, "/search/tv", q, &search); err != nil {
			return Record{}, nil, "", err
		}
		for _, r := range search.Results {
			if _, y := parseDate(r.FirstAirDate); year == 0 || abs(y-year) <= 1 {
				id = strconv.Itoa(r.ID)
				break
			}
		}
		if id == "" {
			return Record{}, nil, "", errNotFound
		}
	}

	var s struct {
		ID           int         `json:"id"`
		Name         string      `json:"name"`
		OriginalName string      `json:"original_name"`
		Overview     string      `json:"overview"`
		Tagline      string      `json:"tagline"`
		FirstAirDate string      `json:"first_air_date"`
		VoteAverage  float32     `json:"vote_average"`
		VoteCount    int         `json:"vote_count"`
		Genres       []tmdbGenre `json:"genres"`
		PosterPath   string      `json:"poster_path"`
		BackdropPath string      `json:"backdrop_path"`
		Credits      tmdbCredits `json:"credits"`
		ExternalIDs  struct {
			IMDbID string `json:"imdb_id"`
			TVDbID int    `json:"tvdb_id"`
		} `json:"external_ids"`
		ContentRatings struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Rating  string `json:"rating"`
			} `json:"results"`
		} `json:"content_ratings"`
	}
	if err := c.get(ctx, "/tv/"+id, url.Values{"append_to_response": {"credits,external_ids,content_ratings"}}, &s); err != nil {
		return Record{}, nil, "", err
	}
	r := Record{
		Title: s.Name, Overview: s.Overview, Tagline: s.Tagline,
		Cast:        s.Credits.people(),
		ExternalIDs: map[string]string{"tmdb": strconv.Itoa(s.ID)},
	}
	if s.OriginalName != s.Name {
		r.OriginalTitle = s.OriginalName
	}
	r.ReleaseDate, r.Year = parseDate(s.FirstAirDate)
	if s.VoteCount > 0 {
		r.Rating = s.VoteAverage
	}
	if s.ExternalIDs.IMDbID != "" {
		r.ExternalIDs["imdb"] = s.ExternalIDs.IMDbID
	}
	if s.ExternalIDs.TVDbID != 0 {
		r.ExternalIDs["tvdb"] = strconv.Itoa(s.ExternalIDs.TVDbID)
	}
	for _, g := range s.Genres {
		r.Genres = append(r.Genres, g.Name)
	}
	for _, cr := range s.ContentRatings.Results {
		if cr.Country == c.region {
			r.ContentRating = cr.Rating
		}
	}
	art := append(c.art("poster", s.PosterPath), c.art("backdrop", s.BackdropPath)...)
	return r, art, strconv.Itoa(s.ID), nil
}

// Episode is one episode of a Season.
type Episode struct {
	Record Record
	Art    []Art
}

// Season returns a season's own record and its episodes by number.
func (c *TMDB) Season(ctx context.Context, showID string, season int) (Record, []Art, map[int]Episode, error) {
	var s struct {
		Name       string `json:"name"`
		Overview   string `json:"overview"`
		AirDate    string `json:"air_date"`
		PosterPath string `json:"poster_path"`
		Episodes   []struct {
			Number      int     `json:"episode_number"`
			Name        string  `json:"name"`
			Overview    string  `json:"overview"`
			AirDate     string  `json:"air_date"`
			Runtime     int     `json:"runtime"`
			VoteAverage float32 `json:"vote_average"`
			VoteCount   int     `json:"vote_count"`
			StillPath   string  `json:"still_path"`
		} `json:"episodes"`
	}
	if err := c.get(ctx, fmt.Sprintf("/tv/%s/season/%d", showID, season), nil, &s); err != nil {
		return Record{}, nil, nil, err
	}
	r := Record{Title: s.Name, Overview: s.Overview}
	r.ReleaseDate, r.Year = parseDate(s.AirDate)
	episodes := map[int]Episode{}
	for _, e := range s.Episodes {
		er := Record{Title: e.Name, Overview: e.Overview, RuntimeMinutes: e.Runtime}
		er.ReleaseDate, er.Year = parseDate(e.AirDate)
		if e.VoteCount > 0 {
			er.Rating = e.VoteAverage
		}
		episodes[e.Number] = Episode{Record: er, Art: c.art("thumb", e.StillPath)}
	}
	return r, c.art("poster", s.PosterPath), episodes, nil
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
