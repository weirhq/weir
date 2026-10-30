package library

import (
	"strconv"
	"strings"
	"testing"
)

// summary renders a match as "kind:title(year)#index/... [edition]" so a
// table can show what it expects at a glance.
func summary(m Match) string {
	var parts []string
	for _, it := range m.Items {
		s := it.Kind + ":" + it.Title
		if it.Year != 0 {
			s += "(" + strconv.Itoa(it.Year) + ")"
		}
		if it.Index != 0 {
			s += "#" + strconv.Itoa(it.Index)
		}
		if it.Disc != 0 {
			s += "d" + strconv.Itoa(it.Disc)
		}
		parts = append(parts, s)
	}
	out := strings.Join(parts, "/")
	if m.Edition != "" {
		out += " [" + m.Edition + "]"
	}
	return out
}

func TestMatchMovies(t *testing.T) {
	for path, want := range map[string]string{
		"Blade Runner (1982)/Blade Runner (1982).mkv":                     "movie:Blade Runner(1982)",
		"Blade Runner (1982)/Blade Runner (1982) - Final Cut.mkv":         "movie:Blade Runner(1982) [Final Cut]",
		"Blade Runner (1982)/Blade Runner (1982) {edition-Workprint}.mkv": "movie:Blade Runner(1982) [Workprint]",
		"Blade Runner 2049 (2017).mkv":                                    "movie:Blade Runner 2049(2017)",
		"Blade.Runner.2049.2017.2160p.UHD.BluRay.x265.mkv":                "movie:Blade Runner 2049(2017)",
		"2001 A Space Odyssey (1968).mp4":                                 "movie:2001 A Space Odyssey(1968)",
		"1917.2019.1080p.mkv":                                             "movie:1917(2019)",
		"Mr. Smith Goes to Washington (1939).mkv":                         "movie:Mr. Smith Goes to Washington(1939)",
		"Arrival (2016)/movie.mkv":                                        "movie:Arrival(2016)",
		"Arrival (2016)/arrival.mkv":                                      "movie:Arrival(2016)",
		"Home Movies/birthday.mp4":                                        "movie:birthday",
	} {
		m, ok := MatchFile(Movies, "/media/films", "/media/films/"+path, nil)
		if !ok {
			t.Errorf("%s: no match", path)
			continue
		}
		if got := summary(m); got != want {
			t.Errorf("%s:\n got %s\nwant %s", path, got, want)
		}
	}
}

func TestMovieKeysIgnoreCaseAndPunctuation(t *testing.T) {
	a, _ := MatchFile(Movies, "/m", "/m/Amélie (2001)/Amélie (2001).mkv", nil)
	b, _ := MatchFile(Movies, "/m", "/m/amélie.2001.1080p.mkv", nil)
	if a.Items[0].Key != b.Items[0].Key {
		t.Errorf("keys differ: %q vs %q", a.Items[0].Key, b.Items[0].Key)
	}
	if a.Items[0].SortTitle != "amélie" {
		t.Errorf("sort title %q", a.Items[0].SortTitle)
	}
	the, _ := MatchFile(Movies, "/m", "/m/The Thing (1982).mkv", nil)
	if the.Items[0].SortTitle != "thing" {
		t.Errorf("sort title %q, want the article dropped", the.Items[0].SortTitle)
	}
}

func TestMatchEpisodes(t *testing.T) {
	for path, want := range map[string]string{
		"Severance (2022)/Season 01/Severance - S01E02 - Half Loop.mkv": "show:Severance(2022)/season:Season 1#1/episode:Half Loop#2",
		"Severance (2022)/Severance.S02E10.1080p.WEB.mkv":               "show:Severance(2022)/season:Season 2#2/episode:Episode 10#10",
		"Doctor Who (2005)/Specials/Doctor Who - S00E03.mkv":            "show:Doctor Who(2005)/season:Specials/episode:Episode 3#3",
		"The Wire/Season 1/1x05 - The Pager.avi":                        "show:The Wire/season:Season 1#1/episode:The Pager#5",
		"Taskmaster S01E01 - Melon Buffet.mkv":                          "show:Taskmaster/season:Season 1#1/episode:Melon Buffet#1",
		"Severance (2022)/Season 01/Severance S01E03.mkv":               "show:Severance(2022)/season:Season 1#1/episode:Episode 3#3",
	} {
		m, ok := MatchFile(Shows, "/media/tv", "/media/tv/"+path, nil)
		if !ok {
			t.Errorf("%s: no match", path)
			continue
		}
		if got := summary(m); got != want {
			t.Errorf("%s:\n got %s\nwant %s", path, got, want)
		}
	}
}

func TestEpisodesNeedANumber(t *testing.T) {
	for _, path := range []string{
		"/media/tv/Severance (2022)/Season 01/behind the scenes.mkv",
		"/media/tv/Severance (2022)/trailer.mp4",
	} {
		if m, ok := MatchFile(Shows, "/media/tv", path, nil); ok {
			t.Errorf("%s matched as %s", path, summary(m))
		}
	}
}

func TestMatchMusicFromTags(t *testing.T) {
	m, ok := MatchFile(Music, "/media/music", "/media/music/misc/track07.flac", map[string]string{
		"artist":       "Kate Bush feat. Peter Gabriel",
		"album_artist": "Kate Bush",
		"album":        "So",
		"title":        "Don't Give Up",
		"track":        "7/9",
		"disc":         "1/1",
		"date":         "1986-05-19",
	})
	if !ok {
		t.Fatal("no match")
	}
	if got, want := summary(m), "artist:Kate Bush/album:So(1986)/track:Don't Give Up#7d1"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestMatchMusicFromPath(t *testing.T) {
	for path, want := range map[string]string{
		"Massive Attack/Mezzanine (1998)/01 - Angel.flac":   "artist:Massive Attack/album:Mezzanine(1998)/track:Angel#1",
		"Massive Attack/Mezzanine (1998)/2-03 Teardrop.mp3": "artist:Massive Attack/album:Mezzanine(1998)/track:Teardrop#3d2",
		"loose.mp3": "artist:Unknown Artist/album:Unknown Album/track:loose",
	} {
		m, ok := MatchFile(Music, "/media/music", "/media/music/"+path, nil)
		if !ok {
			t.Errorf("%s: no match", path)
			continue
		}
		if got := summary(m); got != want {
			t.Errorf("%s:\n got %s\nwant %s", path, got, want)
		}
	}
}

func TestTrackKeysUseDiscAndNumber(t *testing.T) {
	a, _ := MatchFile(Music, "/m", "/m/A/B/1-01 X.flac", nil)
	b, _ := MatchFile(Music, "/m", "/m/A/B/2-01 Y.flac", nil)
	if a.Items[2].Key == b.Items[2].Key {
		t.Errorf("tracks on different discs share key %q", a.Items[2].Key)
	}
}

func TestOutsideRoot(t *testing.T) {
	if _, ok := MatchFile(Movies, "/media/films", "/media/other/Film (2000).mkv", nil); ok {
		t.Error("matched a file outside the library folder")
	}
}
