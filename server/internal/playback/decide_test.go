package playback

import (
	"slices"
	"testing"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

const (
	directPlay     = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY
	remux          = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_REMUX
	audioTranscode = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_AUDIO_TRANSCODE
	videoTranscode = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_VIDEO_TRANSCODE
)

// file builds a probe: a video stream, an audio stream at index 1, and any
// subtitle streams from index 2.
type file struct {
	container string
	codec     string
	profile   string
	width     uint32
	bitDepth  uint32
	hdr       enginev1alpha.HdrFormat
	dv        *enginev1alpha.DolbyVision
	audio     string
	channels  uint32
	bitrate   uint64
	subs      []string // codecs; hdmv_pgs_subtitle is image-based
}

func (f file) probe() *enginev1alpha.ProbeResponse {
	if f.container == "" {
		f.container = "matroska,webm"
	}
	if f.codec == "" {
		f.codec = "h264"
	}
	if f.width == 0 {
		f.width = 1920
	}
	if f.bitDepth == 0 {
		f.bitDepth = 8
	}
	if f.hdr == 0 {
		f.hdr = enginev1alpha.HdrFormat_HDR_FORMAT_SDR
	}
	if f.audio == "" {
		f.audio, f.channels = "aac", 2
	}
	if f.bitrate == 0 {
		f.bitrate = 8_000_000
	}
	p := &enginev1alpha.ProbeResponse{Container: f.container, BitRate: f.bitrate, Streams: []*enginev1alpha.Stream{
		{Index: 0, Kind: enginev1alpha.StreamKind_STREAM_KIND_VIDEO, Codec: f.codec, Profile: f.profile,
			Detail: &enginev1alpha.Stream_Video{Video: &enginev1alpha.VideoDetail{
				Width: f.width, Height: f.width * 9 / 16, BitDepth: f.bitDepth, Level: 120, HdrFormat: f.hdr, DolbyVision: f.dv}}},
		{Index: 1, Kind: enginev1alpha.StreamKind_STREAM_KIND_AUDIO, Codec: f.audio,
			Detail: &enginev1alpha.Stream_Audio{Audio: &enginev1alpha.AudioDetail{Channels: f.channels}}},
	}}
	for i, codec := range f.subs {
		p.Streams = append(p.Streams, &enginev1alpha.Stream{Index: uint32(2 + i), Kind: enginev1alpha.StreamKind_STREAM_KIND_SUBTITLE, Codec: codec,
			Detail: &enginev1alpha.Stream_Subtitle{Subtitle: &enginev1alpha.SubtitleDetail{ImageBased: codec == "hdmv_pgs_subtitle"}}})
	}
	return p
}

func dv(profile, compat uint32) *enginev1alpha.DolbyVision {
	return &enginev1alpha.DolbyVision{Profile: profile, BlCompatId: compat, RpuPresent: true, ElPresent: profile == 7}
}

// browser: Chrome-ish. MP4/WebM, H.264 and AV1, AAC/Opus stereo, no HDR,
// needs HLS for anything it can't play from a file.
func browser() *apiv1alpha.ClientCapabilities {
	return &apiv1alpha.ClientCapabilities{
		Containers:     []string{"mp4", "webm"},
		VideoCodecs:    []*apiv1alpha.VideoCodecSupport{{Codec: "h264", MaxBitDepth: 8}, {Codec: "av1", MaxBitDepth: 10}},
		AudioCodecs:    []*apiv1alpha.AudioCodecSupport{{Codec: "aac", MaxChannels: 2}, {Codec: "opus", MaxChannels: 2}, {Codec: "eac3", MaxChannels: 6}},
		SubtitleCodecs: []string{"webvtt"},
		PlainUrl:       true, Hls: true,
	}
}

// desktop: the mpv client on an HDR screen with DV profiles 5 and 8, and a
// receiver for bitstreamed audio.
func desktop() *apiv1alpha.ClientCapabilities {
	return &apiv1alpha.ClientCapabilities{
		Containers:          []string{"matroska", "mp4"},
		VideoCodecs:         []*apiv1alpha.VideoCodecSupport{{Codec: "h264"}, {Codec: "hevc", MaxBitDepth: 10}, {Codec: "av1", MaxBitDepth: 10}},
		HdrFormats:          []apiv1alpha.HdrFormat{hdr10, hdr10Plus, hlg, dolbyVision},
		DolbyVisionProfiles: []uint32{5, 8},
		AudioCodecs:         []*apiv1alpha.AudioCodecSupport{{Codec: "aac"}, {Codec: "flac"}},
		PassthroughCodecs:   []string{"truehd", "eac3", "dts"},
		SubtitleCodecs:      []string{"subrip", "ass", "hdmv_pgs_subtitle"},
		PlainUrl:            true, Hls: true,
	}
}

func with(c *apiv1alpha.ClientCapabilities, edit func(*apiv1alpha.ClientCapabilities)) *apiv1alpha.ClientCapabilities {
	edit(c)
	return c
}

func decision(p *apiv1alpha.PlaybackPlan, index uint32) *apiv1alpha.StreamDecision {
	for _, s := range p.Streams {
		if s.Index == index {
			return s
		}
	}
	return nil
}

func hasReason(d *apiv1alpha.StreamDecision, r apiv1alpha.PlaybackReason) bool {
	return d != nil && slices.Contains(d.Reasons, r)
}

func TestDecide(t *testing.T) {
	noEngine := EngineCaps{}
	hevcEngine := EngineCaps{HardwareEncoders: map[string]bool{"hevc": true, "h264": true}, TonemapTargets: map[apiv1alpha.HdrFormat]bool{sdr: true}}
	type check func(t *testing.T, p *apiv1alpha.PlaybackPlan)
	video := func(want apiv1alpha.StreamAction, reasons ...apiv1alpha.PlaybackReason) check {
		return func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
			d := decision(p, 0)
			if d.Action != want {
				t.Errorf("video action %v, want %v (reasons %v)", d.Action, want, d.Reasons)
			}
			for _, r := range reasons {
				if !hasReason(d, r) {
					t.Errorf("video reasons %v lack %v", d.Reasons, r)
				}
			}
		}
	}
	output := func(codec string, h apiv1alpha.HdrFormat) check {
		return func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
			if p.Output.VideoCodec != codec || p.Output.HdrFormat != h {
				t.Errorf("output %s %v, want %s %v", p.Output.VideoCodec, p.Output.HdrFormat, codec, h)
			}
		}
	}
	warns := func(want ...apiv1alpha.PlaybackWarning) check {
		return func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
			if !slices.Equal(p.Warnings, want) {
				t.Errorf("warnings %v, want %v", p.Warnings, want)
			}
		}
	}

	cases := []struct {
		name   string
		file   file
		caps   *apiv1alpha.ClientCapabilities
		sel    Selection
		limits Limits
		engine EngineCaps
		method apiv1alpha.PlaybackMethod
		checks []check
	}{
		{name: "mp4 the browser plays", file: file{container: "mov,mp4,m4a,3gp,3g2,mj2"}, caps: browser(),
			method: directPlay, checks: []check{video(actDirect), func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if p.Output.Container != "mp4" {
					t.Errorf("container %q", p.Output.Container)
				}
			}}},
		{name: "webm in a browser", file: file{codec: "vp9", audio: "opus"}, caps: browser(),
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_CODEC_UNSUPPORTED)}},
		{name: "webm with codecs it plays", file: file{codec: "av1", audio: "opus"}, caps: browser(),
			method: directPlay, checks: []check{func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if p.Output.Container != "webm" {
					t.Errorf("container %q", p.Output.Container)
				}
			}}},
		{name: "mkv in a browser", file: file{}, caps: browser(),
			method: remux, checks: []check{video(actRemux, apiv1alpha.PlaybackReason_PLAYBACK_REASON_CONTAINER_UNSUPPORTED)}},
		{name: "client that only does HLS", file: file{container: "mov,mp4"}, caps: with(browser(), func(c *apiv1alpha.ClientCapabilities) { c.PlainUrl = false }),
			method: remux, checks: []check{video(actRemux, apiv1alpha.PlaybackReason_PLAYBACK_REASON_CLIENT_NEEDS_HLS)}},
		{name: "TrueHD 7.1 in a browser", file: file{container: "mov,mp4", audio: "truehd", channels: 8}, caps: browser(),
			method: audioTranscode, checks: []check{video(actRemux), func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if a := decision(p, 1); a.Action != actTranscode || !hasReason(a, apiv1alpha.PlaybackReason_PLAYBACK_REASON_AUDIO_CODEC_UNSUPPORTED) {
					t.Errorf("audio %v", a)
				}
				if p.Output.AudioCodec != "eac3" || p.Output.AudioChannels != 6 {
					t.Errorf("audio out %s %d, want eac3 6", p.Output.AudioCodec, p.Output.AudioChannels)
				}
			}}},
		{name: "TrueHD bitstreamed by the desktop app", file: file{codec: "hevc", bitDepth: 10, audio: "truehd", channels: 8}, caps: desktop(),
			method: directPlay},
		{name: "AAC 5.1 to a stereo-only client", file: file{container: "mov,mp4", audio: "aac", channels: 6}, caps: browser(),
			method: audioTranscode, checks: []check{func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if !hasReason(decision(p, 1), apiv1alpha.PlaybackReason_PLAYBACK_REASON_AUDIO_CHANNELS_ABOVE_LIMIT) {
					t.Error("no channel reason")
				}
			}}},
		{name: "HEVC in Firefox, software", file: file{codec: "hevc"}, caps: browser(), engine: noEngine,
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_CODEC_UNSUPPORTED),
				output("h264", sdr), warns(apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_SOFTWARE_TRANSCODE)}},
		{name: "HEVC in Firefox, Intel iGPU", file: file{codec: "hevc"}, caps: browser(), engine: hevcEngine,
			method: videoTranscode, checks: []check{output("h264", sdr), warns()}},
		{name: "HDR10 on an SDR screen, no tonemapping yet", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_HDR10},
			caps: with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = nil }), engine: EngineCaps{HardwareEncoders: map[string]bool{"hevc": true}},
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_HDR_FORMAT_UNSUPPORTED),
				output("hevc", sdr), warns(apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_TONEMAP_UNAVAILABLE)}},
		{name: "HDR10+ on an HDR10 screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_HDR10_PLUS},
			caps:   with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = []apiv1alpha.HdrFormat{hdr10} }),
			method: directPlay, checks: []check{output("hevc", hdr10)}},
		{name: "DV 5 on a DV screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(5, 0)}, caps: desktop(),
			method: directPlay, checks: []check{output("hevc", dolbyVision)}},
		{name: "DV 5 on an HDR10 screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(5, 0)},
			caps: with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = []apiv1alpha.HdrFormat{hdr10} }), engine: hevcEngine,
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED), output("hevc", hdr10), warns()}},
		{name: "DV 7 to a DV 8 screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(7, 6)}, caps: desktop(),
			method: remux, checks: []check{video(actRemux, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED), output("hevc", dolbyVision)}},
		{name: "DV 7 to an HDR10 screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(7, 6)},
			caps:   with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = []apiv1alpha.HdrFormat{hdr10} }),
			method: remux, checks: []check{output("hevc", hdr10)}},
		{name: "DV 7 to an SDR screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(7, 6)},
			caps: with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = nil }), engine: hevcEngine,
			method: videoTranscode, checks: []check{output("hevc", sdr)}},
		{name: "DV 8.1 on an HDR10 screen plays its base layer", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(8, 1)},
			caps:   with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = []apiv1alpha.HdrFormat{hdr10} }),
			method: directPlay, checks: []check{output("hevc", hdr10)}},
		{name: "DV 8.4 on an HLG screen", file: file{codec: "hevc", bitDepth: 10, hdr: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, dv: dv(8, 4)},
			caps:   with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.HdrFormats = []apiv1alpha.HdrFormat{hlg} }),
			method: directPlay, checks: []check{output("hevc", hlg)}},
		{name: "4K on a 1080p client", file: file{codec: "hevc", width: 3840, bitDepth: 10}, caps: with(desktop(), func(c *apiv1alpha.ClientCapabilities) { c.MaxWidth, c.MaxHeight = 1920, 1080 }),
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_RESOLUTION_ABOVE_LIMIT),
				warns(apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_SOFTWARE_TRANSCODE, apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_SOFTWARE_4K),
				func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
					if p.Output.Width != 1920 || p.Output.Height != 1080 || p.Output.Bitrate != 8_000_000 {
						t.Errorf("scaled to %dx%d at %d", p.Output.Width, p.Output.Height, p.Output.Bitrate)
					}
				}}},
		{name: "over the user's bitrate cap", file: file{bitrate: 40_000_000}, caps: desktop(), limits: Limits{MaxBitrate: 4_000_000},
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_BITRATE_ABOVE_LIMIT), func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if p.Output.Bitrate != 4_000_000 {
					t.Errorf("bitrate %d", p.Output.Bitrate)
				}
			}}},
		{name: "PGS in a browser is burned in", file: file{container: "mov,mp4", subs: []string{"hdmv_pgs_subtitle"}}, caps: browser(), sel: Selection{Audio: 1, Subtitle: 2},
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_SUBTITLE_NEEDS_BURN_IN), func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if decision(p, 2).Action != actBurnIn {
					t.Errorf("subtitle %v", decision(p, 2))
				}
			}}},
		{name: "PGS in the desktop app", file: file{subs: []string{"hdmv_pgs_subtitle"}}, caps: desktop(), sel: Selection{Audio: 1, Subtitle: 2},
			method: directPlay},
		{name: "SRT is a sidecar and changes nothing", file: file{container: "mov,mp4", subs: []string{"subrip"}}, caps: browser(), sel: Selection{Audio: 1, Subtitle: 2},
			method: directPlay, checks: []check{func(t *testing.T, p *apiv1alpha.PlaybackPlan) {
				if decision(p, 2).Action != actSidecar {
					t.Errorf("subtitle %v", decision(p, 2))
				}
			}}},
		{name: "High 10 profile on a browser", file: file{container: "mov,mp4", profile: "High 10", bitDepth: 10}, caps: browser(),
			method: videoTranscode, checks: []check{video(actTranscode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_BIT_DEPTH_UNSUPPORTED)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sel := tc.sel
			if sel == (Selection{}) {
				sel = Selection{Audio: 1, Subtitle: -1}
			}
			p := Decide(tc.file.probe(), tc.caps, sel, tc.limits, tc.engine)
			if p.Method != tc.method {
				t.Fatalf("method %v, want %v; streams %v", p.Method, tc.method, p.Streams)
			}
			for _, c := range tc.checks {
				c(t, p)
			}
		})
	}
}

func TestFit(t *testing.T) {
	for _, c := range []struct{ w, h, mw, mh, ww, wh uint32 }{
		{3840, 2160, 1920, 1080, 1920, 1080},
		{3840, 1600, 1920, 0, 1920, 800},
		{1920, 1080, 0, 0, 1920, 1080},
		{1998, 1080, 1280, 720, 1280, 690},
	} {
		if w, h := fit(c.w, c.h, c.mw, c.mh); w != c.ww || h != c.wh {
			t.Errorf("fit(%d×%d in %d×%d) = %d×%d, want %d×%d", c.w, c.h, c.mw, c.mh, w, h, c.ww, c.wh)
		}
	}
}

func TestEngineCapsFrom(t *testing.T) {
	caps := EngineCapsFrom(&enginev1alpha.CapabilitiesResponse{
		Devices:        []*enginev1alpha.HardwareDevice{{EncodeCodecs: []string{"hevc", "h264"}}},
		TonemapTargets: []enginev1alpha.HdrFormat{enginev1alpha.HdrFormat_HDR_FORMAT_SDR},
	})
	if !caps.HardwareEncoders["hevc"] || !caps.TonemapTargets[sdr] {
		t.Errorf("%+v", caps)
	}
	if empty := EngineCapsFrom(nil); len(empty.HardwareEncoders) != 0 {
		t.Error("nil capabilities reported encoders")
	}
}
