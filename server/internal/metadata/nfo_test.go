package metadata

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func write(t *testing.T, path, body string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

const movieNFO = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
  <title>Arrival</title>
  <originaltitle>Arrival</originaltitle>
  <year>2016</year>
  <premiered>2016-11-11</premiered>
  <plot>A linguist works with the military to communicate with alien lifeforms.</plot>
  <runtime>116</runtime>
  <mpaa>Rated PG-13</mpaa>
  <ratings>
    <rating name="themoviedb" max="10"><value>7.6</value></rating>
    <rating name="imdb" max="10" default="true"><value>7.9</value></rating>
  </ratings>
  <genre>Drama</genre>
  <genre>Science Fiction</genre>
  <uniqueid type="tmdb" default="true">329865</uniqueid>
  <uniqueid type="imdb">tt2543164</uniqueid>
  <actor><name>Amy Adams</name><role>Louise Banks</role></actor>
  <actor><name>Jeremy Renner</name><role>Ian Donnelly</role></actor>
</movie>`

func TestReadMovieNFO(t *testing.T) {
	dir := t.TempDir()
	p := write(t, filepath.Join(dir, "Arrival (2016).nfo"), movieNFO)
	r, ok := readNFO("movie", filepath.Join(dir, "missing.nfo"), p)
	if !ok {
		t.Fatal("not read")
	}
	if r.Title != "Arrival" || r.OriginalTitle != "" || r.Year != 2016 || r.RuntimeMinutes != 116 {
		t.Errorf("basics: %+v", r)
	}
	if r.ReleaseDate.Format("2006-01-02") != "2016-11-11" || r.ContentRating != "PG-13" || r.Rating != 7.9 {
		t.Errorf("date %v, rating %q %v", r.ReleaseDate, r.ContentRating, r.Rating)
	}
	if !slices.Equal(r.Genres, []string{"Drama", "Science Fiction"}) || len(r.Cast) != 2 || r.Cast[0].Role != "Louise Banks" {
		t.Errorf("genres %v, cast %v", r.Genres, r.Cast)
	}
	if r.ExternalIDs["tmdb"] != "329865" || r.ExternalIDs["imdb"] != "tt2543164" {
		t.Errorf("ids %v", r.ExternalIDs)
	}
}

func TestNFOsThatArentNFOs(t *testing.T) {
	dir := t.TempDir()
	link := write(t, filepath.Join(dir, "link.nfo"), "https://www.imdb.com/title/tt2543164/\n")
	show := write(t, filepath.Join(dir, "tvshow.nfo"), "<tvshow><title>Severance</title></tvshow>")
	if _, ok := readNFO("movie", link); ok {
		t.Error("read a bare link as an NFO")
	}
	if _, ok := readNFO("movie", show); ok {
		t.Error("read a tvshow NFO as a movie")
	}
	if r, ok := readNFO("tvshow", show); !ok || r.Title != "Severance" {
		t.Errorf("tvshow: %v %+v", ok, r)
	}
}

func TestCleanCertification(t *testing.T) {
	for in, want := range map[string]string{"Rated PG-13": "PG-13", "US:R": "R", "PG": "PG", "": "", "TV-MA": "TV-MA"} {
		if got := cleanCertification(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func kinds(art []Art) map[string]string {
	m := map[string]string{}
	for _, a := range art {
		m[a.Kind] = filepath.Base(a.Location)
	}
	return m
}

func TestMovieArt(t *testing.T) {
	dir := t.TempDir()
	film := write(t, filepath.Join(dir, "Arrival (2016).mkv"), "")
	write(t, filepath.Join(dir, "POSTER.JPG"), "")
	write(t, filepath.Join(dir, "Arrival (2016)-fanart.png"), "")
	write(t, filepath.Join(dir, "clearlogo.png"), "")

	got := kinds(movieArt(film, true))
	if got["poster"] != "POSTER.JPG" || got["backdrop"] != "Arrival (2016)-fanart.png" || got["logo"] != "clearlogo.png" {
		t.Errorf("own folder: %v", got)
	}
	// Sharing a folder with other films: only art named after this one.
	if got := kinds(movieArt(film, false)); len(got) != 1 || got["backdrop"] == "" {
		t.Errorf("shared folder: %v", got)
	}
}

func TestShowAndAlbumArt(t *testing.T) {
	show := t.TempDir()
	write(t, filepath.Join(show, "folder.jpg"), "")
	write(t, filepath.Join(show, "fanart.jpg"), "")
	write(t, filepath.Join(show, "season01-poster.jpg"), "")
	write(t, filepath.Join(show, "season-specials-poster.jpg"), "")
	write(t, filepath.Join(show, "Season 02", "poster.jpg"), "")
	ep := write(t, filepath.Join(show, "Season 02", "Show - S02E01.mkv"), "")
	write(t, filepath.Join(show, "Season 02", "Show - S02E01-thumb.jpg"), "")

	if got := kinds(folderArt(show, "poster", "folder")); got["poster"] != "folder.jpg" || got["backdrop"] != "fanart.jpg" {
		t.Errorf("show: %v", got)
	}
	for season, want := range map[int]string{0: "season-specials-poster.jpg", 1: "season01-poster.jpg", 2: "poster.jpg"} {
		if got := kinds(seasonPoster(show, filepath.Join(show, "Season 02"), season))["poster"]; got != want {
			t.Errorf("season %d poster %q, want %q", season, got, want)
		}
	}
	if got := kinds(episodeThumb(ep))["thumb"]; got != "Show - S02E01-thumb.jpg" {
		t.Errorf("thumb %q", got)
	}
}
