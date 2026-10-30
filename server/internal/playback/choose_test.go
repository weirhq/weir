package playback

import (
	"strings"
	"testing"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

func streams(specs ...string) *enginev1alpha.ProbeResponse {
	// Each spec is "kind:lang[:default][:forced]".
	p := &enginev1alpha.ProbeResponse{}
	for i, spec := range specs {
		var kind, lang string
		var def, forced bool
		for j, part := range strings.Split(spec, ":") {
			switch {
			case j == 0:
				kind = part
			case j == 1:
				lang = part
			case part == "default":
				def = true
			case part == "forced":
				forced = true
			}
		}
		k := enginev1alpha.StreamKind_STREAM_KIND_AUDIO
		if kind == "sub" {
			k = enginev1alpha.StreamKind_STREAM_KIND_SUBTITLE
		}
		p.Streams = append(p.Streams, &enginev1alpha.Stream{Index: uint32(i), Kind: k, Language: lang,
			Flags: &enginev1alpha.StreamFlags{Default: def, Forced: forced}})
	}
	return p
}

func TestSelectStreams(t *testing.T) {
	film := streams("audio:en:default", "audio:fr", "sub:en", "sub:fr:forced", "sub:en:forced", "sub:de")
	for name, c := range map[string]struct {
		prefs Prefs
		want  Selection
	}{
		"no preferences: default audio, English forced subs": {Prefs{}, Selection{Audio: 0, Subtitle: 4}},
		"French audio brings French forced subs":             {Prefs{AudioLanguage: "fr-FR"}, Selection{Audio: 1, Subtitle: 3}},
		"German subtitles":                                   {Prefs{SubtitleLanguage: "de"}, Selection{Audio: 0, Subtitle: 5}},
		"English subtitles prefer the full track":            {Prefs{SubtitleLanguage: "en"}, Selection{Audio: 0, Subtitle: 2}},
		"unavailable audio language falls back to default":   {Prefs{AudioLanguage: "ja"}, Selection{Audio: 0, Subtitle: 4}},
	} {
		if got := SelectStreams(film, c.prefs); got != c.want {
			t.Errorf("%s: got %+v, want %+v", name, got, c.want)
		}
	}
	if got := SelectStreams(streams("audio:"), Prefs{}); got != (Selection{Audio: 0, Subtitle: -1}) {
		t.Errorf("single unlabelled track: %+v", got)
	}
}

func TestBetter(t *testing.T) {
	plan := func(m apiv1alpha.PlaybackMethod, width uint32, h apiv1alpha.HdrFormat) *apiv1alpha.PlaybackPlan {
		return &apiv1alpha.PlaybackPlan{Method: m, Output: &apiv1alpha.OutputFormat{Width: width, HdrFormat: h}}
	}
	direct1080 := plan(directPlay, 1920, sdr)
	remux4k := plan(remux, 3840, dolbyVision)
	direct4kHDR := plan(directPlay, 3840, hdr10)
	direct4kDV := plan(directPlay, 3840, dolbyVision)
	if !Better(direct1080, remux4k) {
		t.Error("less work should win over a bigger picture")
	}
	if !Better(direct4kHDR, direct1080) || !Better(direct4kDV, direct4kHDR) {
		t.Error("bigger, then better HDR, should win")
	}
}
