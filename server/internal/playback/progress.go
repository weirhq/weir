package playback

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const (
	// Past this share of the runtime a film or episode counts as watched.
	watchedAt = 0.9
	// Past this share a track counts as played.
	playedAt = 0.5
	// Below this share, playback has started over: a new play to count.
	restartBelow = 0.1
)

// RecordProgress updates the user's state for an item from a position.
// Films and episodes keep a resume point until watched; tracks only count
// plays.
func (s *Service) RecordProgress(ctx context.Context, user, itemID uuid.UUID, position time.Duration) error {
	item, err := s.store.GetItem(ctx, itemID)
	if err != nil {
		return err
	}
	durationMs, err := s.store.ItemDurationMs(ctx, itemID)
	if err != nil {
		return err
	}
	state, err := s.store.GetPlaybackState(ctx, dbgen.GetPlaybackStateParams{UserID: user, ItemID: itemID})
	if errors.Is(err, pgx.ErrNoRows) {
		state = dbgen.PlaybackState{UserID: user, ItemID: itemID}
	} else if err != nil {
		return err
	}
	now := time.Now()
	state.LastPlayed = &now
	applyProgress(&state, item.Kind, position.Milliseconds(), durationMs)
	return s.store.PutPlaybackState(ctx, dbgen.PutPlaybackStateParams{
		UserID: state.UserID, ItemID: state.ItemID, PositionMs: state.PositionMs, Watched: state.Watched,
		PlayCount: state.PlayCount, LastPlayed: state.LastPlayed, Counted: state.Counted,
	})
}

// applyProgress is RecordProgress's rule, apart from the database.
func applyProgress(state *dbgen.PlaybackState, kind string, positionMs, durationMs int64) {
	if durationMs <= 0 {
		// Without a runtime there's no telling when it's done.
		if kind != "track" {
			state.PositionMs = positionMs
		}
		return
	}
	share := float64(positionMs) / float64(durationMs)
	if share < restartBelow {
		state.Counted = false
	}
	threshold := watchedAt
	if kind == "track" {
		threshold = playedAt
	}
	if share >= threshold {
		if !state.Counted {
			state.PlayCount++
			state.Counted = true
		}
		state.Watched = true
		state.PositionMs = 0
		return
	}
	if kind != "track" {
		state.PositionMs = positionMs
	}
}
