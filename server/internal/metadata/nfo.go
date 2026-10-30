package metadata

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// nfo is the part of a Kodi NFO file Weir reads. The same fields serve
// <movie>, <tvshow> and <episodedetails>.
type nfo struct {
	XMLName       xml.Name
	Title         string     `xml:"title"`
	OriginalTitle string     `xml:"originaltitle"`
	Year          int        `xml:"year"`
	Premiered     string     `xml:"premiered"`
	Aired         string     `xml:"aired"`
	Plot          string     `xml:"plot"`
	Outline       string     `xml:"outline"`
	Tagline       string     `xml:"tagline"`
	Runtime       int        `xml:"runtime"`
	MPAA          string     `xml:"mpaa"`
	Rating        string     `xml:"rating"`
	Ratings       []rating   `xml:"ratings>rating"`
	Genres        []string   `xml:"genre"`
	UniqueIDs     []uniqueID `xml:"uniqueid"`
	IMDbID        string     `xml:"imdbid"`
	TMDbID        string     `xml:"tmdbid"`
	ID            string     `xml:"id"`
	Actors        []struct {
		Name string `xml:"name"`
		Role string `xml:"role"`
	} `xml:"actor"`
}

type rating struct {
	Default bool    `xml:"default,attr"`
	Value   float32 `xml:"value"`
}

type uniqueID struct {
	Type  string `xml:"type,attr"`
	Value string `xml:",chardata"`
}

// readNFO parses the first of paths that exists and holds an NFO of the
// given root element. ok is false when there is none; a file that is just a
// link (some tools write an IMDb URL) also counts as none.
func readNFO(root string, paths ...string) (r Record, ok bool) {
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var n nfo
		if xml.Unmarshal(data, &n) != nil || n.XMLName.Local != root {
			continue
		}
		return n.record(), true
	}
	return Record{}, false
}

func (n nfo) record() Record {
	r := Record{
		Title:          strings.TrimSpace(n.Title),
		OriginalTitle:  strings.TrimSpace(n.OriginalTitle),
		Overview:       strings.TrimSpace(firstNonEmpty(n.Plot, n.Outline)),
		Tagline:        strings.TrimSpace(n.Tagline),
		RuntimeMinutes: n.Runtime,
		ContentRating:  cleanCertification(n.MPAA),
		ExternalIDs:    map[string]string{},
	}
	if r.OriginalTitle == r.Title {
		r.OriginalTitle = ""
	}
	r.ReleaseDate, r.Year = parseDate(firstNonEmpty(n.Premiered, n.Aired))
	if n.Year != 0 {
		r.Year = n.Year
	}
	for _, rt := range n.Ratings {
		if rt.Default || r.Rating == 0 {
			r.Rating = rt.Value
		}
	}
	if r.Rating == 0 {
		if f, err := strconv.ParseFloat(strings.TrimSpace(n.Rating), 32); err == nil {
			r.Rating = float32(f)
		}
	}
	for _, g := range n.Genres {
		if g = strings.TrimSpace(g); g != "" {
			r.Genres = append(r.Genres, g)
		}
	}
	for _, a := range n.Actors {
		if name := strings.TrimSpace(a.Name); name != "" {
			r.Cast = append(r.Cast, Person{Name: name, Role: strings.TrimSpace(a.Role)})
		}
	}
	for _, u := range n.UniqueIDs {
		if t, v := strings.ToLower(strings.TrimSpace(u.Type)), strings.TrimSpace(u.Value); t != "" && v != "" {
			r.ExternalIDs[t] = v
		}
	}
	if n.IMDbID != "" {
		r.ExternalIDs["imdb"] = n.IMDbID
	}
	if n.TMDbID != "" {
		r.ExternalIDs["tmdb"] = n.TMDbID
	}
	if strings.HasPrefix(n.ID, "tt") {
		r.ExternalIDs["imdb"] = n.ID
	}
	return r
}

// cleanCertification turns "Rated PG-13" or "US:PG-13" into "PG-13".
func cleanCertification(s string) string {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "Rated "))
	if _, after, ok := strings.Cut(s, ":"); ok && len(s) > 2 && s[2] == ':' {
		s = after
	}
	return strings.TrimSpace(s)
}

// dirFiles maps a folder's lowercased file names to their paths, so artwork
// matches whatever case it was saved in.
type dirFiles map[string]string

func listDir(dir string) dirFiles {
	files := dirFiles{}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() {
			files[strings.ToLower(e.Name())] = filepath.Join(dir, e.Name())
		}
	}
	return files
}

// find returns the first of names (without extension) present as a .jpg,
// .jpeg, .png or .webp.
func (f dirFiles) find(names ...string) string {
	for _, n := range names {
		for _, ext := range []string{".jpg", ".jpeg", ".png", ".webp"} {
			if p, ok := f[strings.ToLower(n)+ext]; ok {
				return p
			}
		}
	}
	return ""
}

func addArt(art []Art, kind, path string) []Art {
	if path == "" {
		return art
	}
	return append(art, Art{Kind: kind, Source: SourceLocal, Location: path})
}

// movieArt finds a film's pictures. Generic names such as poster.jpg count
// only when the film has a folder of its own.
func movieArt(file string, ownFolder bool) []Art {
	dir, stem := filepath.Dir(file), strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	f := listDir(dir)
	generic := func(names ...string) []string {
		if ownFolder {
			return names
		}
		return nil
	}
	var art []Art
	art = addArt(art, "poster", f.find(append([]string{stem + "-poster"}, generic("poster", "folder", "cover")...)...))
	art = addArt(art, "backdrop", f.find(append([]string{stem + "-fanart", stem + "-backdrop"}, generic("fanart", "backdrop", "background")...)...))
	art = addArt(art, "logo", f.find(append([]string{stem + "-clearlogo", stem + "-logo"}, generic("clearlogo", "logo")...)...))
	return art
}

// folderArt finds a show's or album's pictures in its folder.
func folderArt(dir string, posterNames ...string) []Art {
	f := listDir(dir)
	var art []Art
	art = addArt(art, "poster", f.find(posterNames...))
	art = addArt(art, "backdrop", f.find("fanart", "backdrop", "background"))
	art = addArt(art, "logo", f.find("clearlogo", "logo"))
	return art
}

// seasonPoster finds season01-poster.jpg in the show folder (Kodi), or a
// poster in the season's own folder.
func seasonPoster(showDir, seasonDir string, season int) []Art {
	name := fmt.Sprintf("season%02d-poster", season)
	if season == 0 {
		name = "season-specials-poster"
	}
	if p := listDir(showDir).find(name); p != "" {
		return addArt(nil, "poster", p)
	}
	if seasonDir != "" && seasonDir != showDir {
		return addArt(nil, "poster", listDir(seasonDir).find("poster", "folder"))
	}
	return nil
}

func episodeThumb(file string) []Art {
	stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	return addArt(nil, "thumb", listDir(filepath.Dir(file)).find(stem+"-thumb"))
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
