package playback

import (
	"strings"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

// Prefs are a user's playback preferences. Empty means none.
type Prefs struct {
	AudioLanguage, SubtitleLanguage string
	MaxBitrate                      uint64
}

// SelectStreams picks the audio and subtitle streams to play: the preferred
// language first, then the file's default, then the first. Subtitles come
// on for a preferred subtitle language, or as forced subtitles in the audio's
// language.
func SelectStreams(probe *enginev1alpha.ProbeResponse, prefs Prefs) Selection {
	sel := Selection{Audio: -1, Subtitle: -1}
	var audio, subs []*enginev1alpha.Stream
	for _, s := range probe.GetStreams() {
		switch s.GetKind() {
		case enginev1alpha.StreamKind_STREAM_KIND_AUDIO:
			audio = append(audio, s)
		case enginev1alpha.StreamKind_STREAM_KIND_SUBTITLE:
			subs = append(subs, s)
		}
	}

	var chosen *enginev1alpha.Stream
	for _, pick := range []func(*enginev1alpha.Stream) bool{
		func(s *enginev1alpha.Stream) bool { return sameLanguage(s.GetLanguage(), prefs.AudioLanguage) },
		func(s *enginev1alpha.Stream) bool { return s.GetFlags().GetDefault() },
		func(*enginev1alpha.Stream) bool { return true },
	} {
		if chosen = first(audio, pick); chosen != nil {
			break
		}
	}
	if chosen != nil {
		sel.Audio = int(chosen.GetIndex())
	}

	var sub *enginev1alpha.Stream
	if prefs.SubtitleLanguage != "" {
		// Full subtitles before forced-only ones.
		sub = first(subs, func(s *enginev1alpha.Stream) bool {
			return sameLanguage(s.GetLanguage(), prefs.SubtitleLanguage) && !s.GetFlags().GetForced()
		})
		if sub == nil {
			sub = first(subs, func(s *enginev1alpha.Stream) bool { return sameLanguage(s.GetLanguage(), prefs.SubtitleLanguage) })
		}
	}
	if sub == nil && chosen != nil {
		sub = first(subs, func(s *enginev1alpha.Stream) bool {
			return s.GetFlags().GetForced() && (s.GetLanguage() == "" || sameLanguage(s.GetLanguage(), chosen.GetLanguage()))
		})
	}
	if sub != nil {
		sel.Subtitle = int(sub.GetIndex())
	}
	return sel
}

func first(streams []*enginev1alpha.Stream, ok func(*enginev1alpha.Stream) bool) *enginev1alpha.Stream {
	for _, s := range streams {
		if ok(s) {
			return s
		}
	}
	return nil
}

// sameLanguage compares BCP 47 tags by primary language: "en" matches
// "en-GB".
func sameLanguage(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	pa, _, _ := strings.Cut(strings.ToLower(a), "-")
	pb, _, _ := strings.Cut(strings.ToLower(b), "-")
	return pa == pb
}

var methodRank = map[apiv1alpha.PlaybackMethod]int{
	apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY:     0,
	apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_REMUX:           1,
	apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_AUDIO_TRANSCODE: 2,
	apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_VIDEO_TRANSCODE: 3,
}

var hdrRank = map[apiv1alpha.HdrFormat]int{
	dolbyVision: 4, hdr10Plus: 3, hdr10: 2, hlg: 1,
}

// Better reports whether plan a beats plan b: less work for the server, then
// a larger picture, then better HDR.
func Better(a, b *apiv1alpha.PlaybackPlan) bool {
	if ra, rb := methodRank[a.GetMethod()], methodRank[b.GetMethod()]; ra != rb {
		return ra < rb
	}
	if wa, wb := a.GetOutput().GetWidth(), b.GetOutput().GetWidth(); wa != wb {
		return wa > wb
	}
	return hdrRank[a.GetOutput().GetHdrFormat()] > hdrRank[b.GetOutput().GetHdrFormat()]
}
