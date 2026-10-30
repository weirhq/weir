package playback

import (
	"testing"

	"github.com/weirhq/weir/server/internal/store/dbgen"
)

func TestApplyProgress(t *testing.T) {
	const minute = 60_000
	type state struct {
		pos     int64
		watched bool
		count   int32
		counted bool
	}
	for _, c := range []struct {
		name     string
		kind     string
		before   state
		position int64
		duration int64
		after    state
	}{
		{"part way through a film", "movie", state{}, 30 * minute, 100 * minute, state{pos: 30 * minute}},
		{"past 90% is watched", "movie", state{pos: 80 * minute}, 91 * minute, 100 * minute, state{watched: true, count: 1, counted: true}},
		{"credits roll on: counted once", "movie", state{watched: true, count: 1, counted: true}, 99 * minute, 100 * minute, state{watched: true, count: 1, counted: true}},
		{"rewatching from the start", "episode", state{watched: true, count: 1, counted: true}, 2 * minute, 100 * minute, state{pos: 2 * minute, watched: true, count: 1}},
		{"second viewing completes", "episode", state{pos: 50 * minute, watched: true, count: 1}, 95 * minute, 100 * minute, state{watched: true, count: 2, counted: true}},
		{"a track has no resume point", "track", state{}, 60_000, 240_000, state{}},
		{"half a track is a play", "track", state{}, 130_000, 240_000, state{watched: true, count: 1, counted: true}},
		{"unknown runtime keeps the position", "movie", state{}, 5 * minute, 0, state{pos: 5 * minute}},
	} {
		s := dbgen.PlaybackState{PositionMs: c.before.pos, Watched: c.before.watched, PlayCount: c.before.count, Counted: c.before.counted}
		applyProgress(&s, c.kind, c.position, c.duration)
		got := state{s.PositionMs, s.Watched, s.PlayCount, s.Counted}
		if got != c.after {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.after)
		}
	}
}
