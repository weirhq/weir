// Package library scans library folders into items, versions and media
// files.
package library

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Kind is a library's kind, as stored in library.kind.
type Kind string

const (
	Movies Kind = "movies"
	Shows  Kind = "shows"
	Music  Kind = "music"
)

// A Match places one file in the item hierarchy.
type Match struct {
	// Top first (show, artist); the last is the item the file is a version of.
	Items []ItemRef
	// The version's label, e.g. "Director's Cut" or "4K DV".
	Edition string
}

// ItemRef identifies an item among its siblings by Key.
type ItemRef struct {
	Kind      string
	Title     string
	SortTitle string
	Year      int // 0 when unknown
	Index     int // season, episode or track number; 0 when unknown
	Disc      int
	Key       string
}

var (
	parenYear   = regexp.MustCompile(`^(.+?)\s*[(\[]((?:19|20)\d{2})[)\]](.*)$`)
	bareYear    = regexp.MustCompile(`^\(?((?:19|20)\d{2})\)?$`)
	editionTag  = regexp.MustCompile(`(?i)\{edition-([^}]+)\}`)
	episodeSxE  = regexp.MustCompile(`(?i)s(\d{1,3})[ ._-]?e(\d{1,4})`)
	episodeNxN  = regexp.MustCompile(`(?i)(?:^|[^\d])(\d{1,2})x(\d{2,3})(?:[^\d]|$)`)
	trackPrefix = regexp.MustCompile(`^(?:(\d)[-.])?(\d{1,3})[\s.\-_]+(.+)$`)
	leadingNum  = regexp.MustCompile(`^\d+`)
)

// MatchFile works out where the file at path, under the library folder root,
// belongs. tags are the container's tags (lowercased keys), which music
// prefers over the path. It reports false for a file it can't place.
func MatchFile(kind Kind, root, path string, tags map[string]string) (Match, bool) {
	rel, err := filepath.Rel(root, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return Match{}, false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	stem := strings.TrimSuffix(parts[len(parts)-1], filepath.Ext(path))
	dirs := parts[:len(parts)-1]
	switch kind {
	case Movies:
		return matchMovie(stem, dirs)
	case Shows:
		return matchEpisode(stem, dirs)
	case Music:
		return matchTrack(stem, dirs, tags)
	}
	return Match{}, false
}

func matchMovie(stem string, dirs []string) (Match, bool) {
	edition := ""
	if m := editionTag.FindStringSubmatch(stem); m != nil {
		edition = strings.TrimSpace(m[1])
		stem = strings.TrimSpace(editionTag.ReplaceAllString(stem, ""))
	}
	title, year, rest := splitTitleYear(stem)
	// "Movie (Year)/Movie.mkv": the folder names the film when the file
	// doesn't.
	if year == 0 && len(dirs) > 0 {
		if t, y, _ := splitTitleYear(dirs[len(dirs)-1]); y != 0 {
			title, year, rest = t, y, ""
		}
	}
	if title == "" {
		return Match{}, false
	}
	// "Blade Runner (1982) - Final Cut.mkv". A scene name's trailing
	// "1080p BluRay" is not an edition.
	if rest = strings.TrimSpace(rest); edition == "" && strings.HasPrefix(rest, "-") {
		edition = strings.TrimSpace(strings.TrimLeft(rest, "- "))
	}
	return Match{
		Items:   []ItemRef{{Kind: "movie", Title: title, SortTitle: sortTitle(title), Year: year, Key: titleKey(title, year)}},
		Edition: edition,
	}, true
}

func matchEpisode(stem string, dirs []string) (Match, bool) {
	season, episode, start, end, ok := findEpisode(stem)
	if !ok {
		return Match{}, false
	}
	after := stem[end:]
	var show string
	var year int
	if len(dirs) > 0 {
		show, year, _ = splitTitleYear(dirs[0])
	} else {
		// A file straight in the library folder: the show is the name before
		// the episode number.
		show, year, _ = splitTitleYear(strings.Trim(stem[:start], " -._"))
	}
	if show == "" {
		return Match{}, false
	}
	title := strings.TrimSpace(strings.TrimLeft(after, " -._"))
	if title == "" || !strings.Contains(after, " - ") && strings.ContainsAny(title, ".") {
		title = fmt.Sprintf("Episode %d", episode)
	}
	seasonTitle := fmt.Sprintf("Season %d", season)
	if season == 0 {
		seasonTitle = "Specials"
	}
	return Match{Items: []ItemRef{
		{Kind: "show", Title: show, SortTitle: sortTitle(show), Year: year, Key: titleKey(show, year)},
		{Kind: "season", Title: seasonTitle, SortTitle: fmt.Sprintf("%04d", season), Index: season, Key: fmt.Sprintf("s%d", season)},
		{Kind: "episode", Title: title, SortTitle: fmt.Sprintf("%05d", episode), Index: episode, Key: fmt.Sprintf("e%d", episode)},
	}}, true
}

// findEpisode finds "S01E02" or "1x02" in a file name, returning the
// numbers and where the token starts and ends.
func findEpisode(stem string) (season, episode, start, end int, ok bool) {
	for _, re := range []*regexp.Regexp{episodeSxE, episodeNxN} {
		if m := re.FindStringSubmatchIndex(stem); m != nil {
			season, _ = strconv.Atoi(stem[m[2]:m[3]])
			episode, _ = strconv.Atoi(stem[m[4]:m[5]])
			// The SxE pattern starts with "s"; NxN starts at its first digit.
			start = m[2]
			if re == episodeSxE {
				start = m[0]
			}
			return season, episode, start, m[5], true
		}
	}
	return 0, 0, 0, 0, false
}

func matchTrack(stem string, dirs []string, tags map[string]string) (Match, bool) {
	artist := firstTag(tags, "album_artist", "albumartist", "album artist", "artist")
	album := firstTag(tags, "album")
	title := firstTag(tags, "title")
	track := leadingInt(firstTag(tags, "track", "tracknumber"))
	disc := leadingInt(firstTag(tags, "disc", "discnumber"))
	year := leadingInt(firstTag(tags, "date", "year", "originaldate"))

	// Artist/Album/01 - Title.flac, for whatever the tags leave out.
	if artist == "" && len(dirs) >= 2 {
		artist = dirs[len(dirs)-2]
	}
	if album == "" && len(dirs) >= 1 {
		var y int
		album, y, _ = splitTitleYear(dirs[len(dirs)-1])
		if year == 0 {
			year = y
		}
	}
	if m := trackPrefix.FindStringSubmatch(stem); m != nil {
		if track == 0 {
			track, _ = strconv.Atoi(m[2])
		}
		if disc == 0 && m[1] != "" {
			disc, _ = strconv.Atoi(m[1])
		}
		if title == "" {
			title = strings.TrimSpace(m[3])
		}
	}
	if title == "" {
		title = stem
	}
	if artist == "" {
		artist = "Unknown Artist"
	}
	if album == "" {
		album = "Unknown Album"
	}
	if year < 1000 || year > 9999 {
		year = 0
	}

	trackKey := "t:" + normalize(title)
	if track > 0 {
		trackKey = fmt.Sprintf("d%dt%d", max(disc, 1), track)
	}
	return Match{Items: []ItemRef{
		{Kind: "artist", Title: artist, SortTitle: sortTitle(artist), Key: normalize(artist)},
		{Kind: "album", Title: album, SortTitle: sortTitle(album), Year: year, Key: normalize(album)},
		{Kind: "track", Title: title, SortTitle: fmt.Sprintf("%02d%04d", max(disc, 1), track), Index: track, Disc: disc, Key: trackKey},
	}}, true
}

// splitTitleYear splits "Title (Year) rest" or a scene name such as
// "Title.Year.1080p.BluRay" into its title, year and anything after the year.
func splitTitleYear(s string) (title string, year int, rest string) {
	if m := parenYear.FindStringSubmatch(s); m != nil {
		year, _ = strconv.Atoi(m[2])
		return cleanTitle(m[1]), year, m[3]
	}
	words := strings.Fields(spaced(s))
	// The last year-like word wins: "Blade Runner 2049 2017 1080p" is from
	// 2017. The first word is always title ("1917 2019").
	for i := len(words) - 1; i > 0; i-- {
		if m := bareYear.FindStringSubmatch(words[i]); m != nil {
			year, _ = strconv.Atoi(m[1])
			return cleanTitle(strings.Join(words[:i], " ")), year, strings.Join(words[i+1:], " ")
		}
	}
	return cleanTitle(s), 0, ""
}

// spaced turns a scene name's dots and underscores into spaces. Names that
// already have spaces keep their dots ("Mr. Smith").
func spaced(s string) string {
	if strings.Contains(s, " ") {
		return s
	}
	return strings.NewReplacer(".", " ", "_", " ").Replace(s)
}

func cleanTitle(s string) string {
	return strings.Join(strings.Fields(strings.Trim(spaced(s), " -_.")), " ")
}

// titleKey identifies a film or show by its title and year, ignoring case
// and punctuation.
func titleKey(title string, year int) string {
	if year == 0 {
		return normalize(title)
	}
	return fmt.Sprintf("%s|%d", normalize(title), year)
}

func normalize(s string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			b.WriteRune(r)
			space = false
		default:
			space = true
		}
	}
	return b.String()
}

// sortTitle drops a leading English article and case.
func sortTitle(title string) string {
	t := strings.ToLower(title)
	for _, article := range []string{"the ", "a ", "an "} {
		if rest, ok := strings.CutPrefix(t, article); ok && rest != "" {
			return rest
		}
	}
	return t
}

func firstTag(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

// leadingInt reads "3/12" or "2019-05-01" as 3 and 2019.
func leadingInt(s string) int {
	n, _ := strconv.Atoi(leadingNum.FindString(strings.TrimSpace(s)))
	return n
}
