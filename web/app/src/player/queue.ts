import { create } from 'zustand'
import type { ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'

type Queue = {
  tracks: ItemSummary[]
  index: number
  // Bumped on every change of track, so playing the same track again starts
  // a new session.
  playId: number
  start(tracks: ItemSummary[], index?: number): void
  skipTo(index: number): void
  next(): void
  previous(): void
  clear(): void
}

/** What the mini-player plays: a list of tracks and where it is in them. */
export const useQueue = create<Queue>()((set) => ({
  tracks: [],
  index: 0,
  playId: 0,
  start: (tracks, index = 0) =>
    set((q) => ({ tracks, index, playId: q.playId + 1 })),
  skipTo: (index) => set((q) => ({ index, playId: q.playId + 1 })),
  // Past the last track the queue empties and the mini-player goes away.
  next: () =>
    set((q) =>
      q.index + 1 < q.tracks.length
        ? { index: q.index + 1, playId: q.playId + 1 }
        : { tracks: [], index: 0 }
    ),
  previous: () =>
    set((q) => ({ index: Math.max(0, q.index - 1), playId: q.playId + 1 })),
  clear: () => set({ tracks: [], index: 0 })
}))
