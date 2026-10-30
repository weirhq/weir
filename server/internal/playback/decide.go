// Package playback decides how an item plays on a client: direct play,
// remux, or transcode, stream by stream, with the reasons.
package playback

import (
	"slices"
	"strings"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
)

// Selection is which audio and subtitle streams to play, by index. -1
// means none.
type Selection struct {
	Audio, Subtitle int
}

// Limits are the user's own caps, on top of the client's.
type Limits struct {
	// Bits per second; zero means no limit.
	MaxBitrate uint64
}

// EngineCaps is what the engine can do, from its Capabilities.
type EngineCaps struct {
	// Codecs some hardware device can encode.
	HardwareEncoders map[string]bool
	// HDR formats the engine can tonemap to.
	TonemapTargets map[apiv1alpha.HdrFormat]bool
}

// EngineCapsFrom reads an engine's Capabilities. A nil response (the engine
// hasn't reported) means no hardware and no tonemapping.
func EngineCapsFrom(c *enginev1alpha.CapabilitiesResponse) EngineCaps {
	caps := EngineCaps{HardwareEncoders: map[string]bool{}, TonemapTargets: map[apiv1alpha.HdrFormat]bool{}}
	for _, d := range c.GetDevices() {
		for _, codec := range d.GetEncodeCodecs() {
			caps.HardwareEncoders[codec] = true
		}
	}
	for _, f := range c.GetTonemapTargets() {
		caps.TonemapTargets[hdrFromEngine(f)] = true
	}
	return caps
}

type (
	hdrFormat = apiv1alpha.HdrFormat
	reason    = apiv1alpha.PlaybackReason
	action    = apiv1alpha.StreamAction
)

const (
	sdr         = apiv1alpha.HdrFormat_HDR_FORMAT_SDR
	hdr10       = apiv1alpha.HdrFormat_HDR_FORMAT_HDR10
	hdr10Plus   = apiv1alpha.HdrFormat_HDR_FORMAT_HDR10_PLUS
	hlg         = apiv1alpha.HdrFormat_HDR_FORMAT_HLG
	dolbyVision = apiv1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION

	actDirect    = apiv1alpha.StreamAction_STREAM_ACTION_DIRECT
	actRemux     = apiv1alpha.StreamAction_STREAM_ACTION_REMUX
	actTranscode = apiv1alpha.StreamAction_STREAM_ACTION_TRANSCODE
	actBurnIn    = apiv1alpha.StreamAction_STREAM_ACTION_BURN_IN
	actSidecar   = apiv1alpha.StreamAction_STREAM_ACTION_SIDECAR
)

// Output containers. HLS segments are fragmented MP4.
const hlsContainer = "mp4"

// Transcode targets, best first (spec §8).
var videoTargets = []string{"av1", "hevc", "h264"}

// Video transcode bitrate ceilings by output height, in bits per second.
var bitrateByHeight = []struct {
	height  uint32
	bitrate uint64
}{{2160, 25_000_000}, {1440, 16_000_000}, {1080, 10_000_000}, {720, 5_000_000}, {0, 2_500_000}}

// Decide works out how the selected streams of probe play on caps. The plan
// has no version id or URL; the caller adds those.
func Decide(probe *enginev1alpha.ProbeResponse, caps *apiv1alpha.ClientCapabilities, sel Selection, limits Limits, engine EngineCaps) *apiv1alpha.PlaybackPlan {
	d := decider{probe: probe, caps: caps, limits: limits, engine: engine}
	return d.decide(sel)
}

type decider struct {
	probe  *enginev1alpha.ProbeResponse
	caps   *apiv1alpha.ClientCapabilities
	limits Limits
	engine EngineCaps
}

// videoVerdict is what the video stream needs.
type videoVerdict struct {
	transcode []reason // any of these forces a re-encode
	remux     []reason // a rewrite without re-encoding (Dolby Vision)
	// The HDR format the client sees if the video isn't re-encoded.
	outHDR hdrFormat
}

func (d *decider) decide(sel Selection) *apiv1alpha.PlaybackPlan {
	video := d.videoStream()
	audio := d.stream(sel.Audio, enginev1alpha.StreamKind_STREAM_KIND_AUDIO)
	sub := d.stream(sel.Subtitle, enginev1alpha.StreamKind_STREAM_KIND_SUBTITLE)

	var vv videoVerdict
	if video != nil {
		vv = d.judgeVideo(video)
	}
	audioReasons := d.judgeAudio(audio)

	// An image subtitle the client can't draw is burned into the video.
	burnIn := sub != nil && sub.GetSubtitle().GetImageBased() && !slices.Contains(d.caps.GetSubtitleCodecs(), sub.GetCodec())
	if burnIn && video != nil {
		vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_SUBTITLE_NEEDS_BURN_IN)
	}

	var containerReasons []reason
	if !d.containerSupported() {
		containerReasons = append(containerReasons, apiv1alpha.PlaybackReason_PLAYBACK_REASON_CONTAINER_UNSUPPORTED)
	}
	if !d.caps.GetPlainUrl() {
		containerReasons = append(containerReasons, apiv1alpha.PlaybackReason_PLAYBACK_REASON_CLIENT_NEEDS_HLS)
	}

	plan := &apiv1alpha.PlaybackPlan{}
	switch {
	case len(vv.transcode) > 0:
		plan.Method = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_VIDEO_TRANSCODE
	case len(audioReasons) > 0:
		plan.Method = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_AUDIO_TRANSCODE
	case len(containerReasons) > 0 || len(vv.remux) > 0:
		plan.Method = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_REMUX
	default:
		plan.Method = apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY
	}
	direct := plan.Method == apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY

	// A copied stream in a new container carries the container's reasons.
	copied := func(own []reason) (action, []reason) {
		if direct {
			return actDirect, nil
		}
		return actRemux, append(slices.Clone(containerReasons), own...)
	}

	out := &apiv1alpha.OutputFormat{Container: hlsContainer}
	if direct {
		out.Container = d.container()
	}
	if video != nil {
		dec := &apiv1alpha.StreamDecision{Index: video.GetIndex()}
		if len(vv.transcode) > 0 {
			dec.Action, dec.Reasons = actTranscode, vv.transcode
			d.videoTarget(video, out, &plan.Warnings)
		} else {
			dec.Action, dec.Reasons = copied(vv.remux)
			v := video.GetVideo()
			out.VideoCodec, out.HdrFormat, out.Width, out.Height = video.GetCodec(), vv.outHDR, v.GetWidth(), v.GetHeight()
		}
		plan.Streams = append(plan.Streams, dec)
	}
	if audio != nil {
		dec := &apiv1alpha.StreamDecision{Index: audio.GetIndex()}
		if len(audioReasons) > 0 {
			dec.Action, dec.Reasons = actTranscode, audioReasons
			out.AudioCodec, out.AudioChannels = d.audioTarget(audio)
		} else {
			dec.Action, dec.Reasons = copied(nil)
			out.AudioCodec, out.AudioChannels = audio.GetCodec(), audio.GetAudio().GetChannels()
		}
		plan.Streams = append(plan.Streams, dec)
	}
	if sub != nil {
		dec := &apiv1alpha.StreamDecision{Index: sub.GetIndex()}
		switch {
		case burnIn:
			dec.Action = actBurnIn
			dec.Reasons = []reason{apiv1alpha.PlaybackReason_PLAYBACK_REASON_SUBTITLE_NEEDS_BURN_IN}
		case sub.GetSubtitle().GetImageBased():
			dec.Action, dec.Reasons = copied(nil)
		default:
			// Text subtitles are extracted and served beside the media.
			dec.Action = actSidecar
		}
		plan.Streams = append(plan.Streams, dec)
	}
	plan.Output = out
	return plan
}

func (d *decider) videoStream() *enginev1alpha.Stream {
	for _, s := range d.probe.GetStreams() {
		if s.GetKind() == enginev1alpha.StreamKind_STREAM_KIND_VIDEO {
			return s
		}
	}
	return nil
}

func (d *decider) stream(index int, kind enginev1alpha.StreamKind) *enginev1alpha.Stream {
	if index < 0 {
		return nil
	}
	for _, s := range d.probe.GetStreams() {
		if int(s.GetIndex()) == index && s.GetKind() == kind {
			return s
		}
	}
	return nil
}

// webmCodecs are the only codecs a WebM file may hold.
var webmCodecs = map[string]bool{"vp8": true, "vp9": true, "av1": true, "opus": true, "vorbis": true, "webvtt": true}

// container names the file's container the way clients declare them.
// ffmpeg reports families ("matroska,webm" for both .mkv and .webm), so a
// Matroska file counts as WebM only when every stream is a WebM codec.
func (d *decider) container() string {
	family := d.probe.GetContainer()
	switch {
	case strings.HasPrefix(family, "matroska"):
		for _, s := range d.probe.GetStreams() {
			if !webmCodecs[s.GetCodec()] {
				return "matroska"
			}
		}
		return "webm"
	case strings.HasPrefix(family, "mov,mp4"):
		return "mp4"
	}
	first, _, _ := strings.Cut(family, ",")
	return first
}

func (d *decider) containerSupported() bool {
	return slices.Contains(d.caps.GetContainers(), d.container())
}

// maxBitrate is the lower of the client's and the user's caps; zero means
// none.
func (d *decider) maxBitrate() uint64 {
	c, u := d.caps.GetMaxBitrate(), d.limits.MaxBitrate
	switch {
	case c == 0:
		return u
	case u == 0:
		return c
	}
	return min(c, u)
}

func (d *decider) judgeVideo(s *enginev1alpha.Stream) videoVerdict {
	v := s.GetVideo()
	var vv videoVerdict
	support := d.videoSupport(s.GetCodec())
	if support == nil {
		vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_CODEC_UNSUPPORTED)
	} else {
		if len(support.GetProfiles()) > 0 && !slices.Contains(support.GetProfiles(), s.GetProfile()) {
			vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_PROFILE_UNSUPPORTED)
		}
		if support.GetMaxLevel() != 0 && v.GetLevel() > support.GetMaxLevel() {
			vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_LEVEL_UNSUPPORTED)
		}
		if v.GetBitDepth() > bitDepth(support) {
			vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_VIDEO_BIT_DEPTH_UNSUPPORTED)
		}
	}
	if w, h := d.caps.GetMaxWidth(), d.caps.GetMaxHeight(); w != 0 && v.GetWidth() > w || h != 0 && v.GetHeight() > h {
		vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_RESOLUTION_ABOVE_LIMIT)
	}
	if limit := d.maxBitrate(); limit != 0 && d.probe.GetBitRate() > limit {
		vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_BITRATE_ABOVE_LIMIT)
	}
	d.judgeHDR(v, &vv)
	return vv
}

// judgeHDR applies the spec's HDR and Dolby Vision table: what the client
// can show as is, what a rewrite fixes, and what needs a re-encode.
func (d *decider) judgeHDR(v *enginev1alpha.VideoDetail, vv *videoVerdict) {
	format := hdrFromEngine(v.GetHdrFormat())
	if format == apiv1alpha.HdrFormat_HDR_FORMAT_UNSPECIFIED {
		format = sdr
	}
	if format == dolbyVision {
		dv := v.GetDolbyVision()
		switch {
		case d.showsDV(dv.GetProfile()):
			vv.outHDR = dolbyVision
			return
		case dv.GetProfile() == 7 && d.showsDV(8):
			// Dual layer to single: strip the enhancement layer, keep the RPU.
			vv.outHDR = dolbyVision
			vv.remux = append(vv.remux, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED)
			return
		case dv.GetProfile() == 7 && d.shows(hdr10):
			// Strip the enhancement layer and RPU, leaving plain HDR10.
			vv.outHDR = hdr10
			vv.remux = append(vv.remux, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED)
			return
		}
		// Otherwise the base layer decides: HDR10, SDR or HLG compatible, or
		// none at all (profile 5).
		switch dv.GetBlCompatId() {
		case 1:
			format = hdr10
		case 2:
			format = sdr
		case 4:
			format = hlg
		default:
			vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED)
			return
		}
		if dv.GetProfile() == 7 {
			// A profile 7 base layer only plays once the enhancement layer
			// is gone, and the client shows neither DV nor HDR10.
			vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_DOLBY_VISION_PROFILE_UNSUPPORTED)
			return
		}
	}
	// HDR10+ is HDR10 with extra metadata an HDR10 screen ignores.
	if format == hdr10Plus && !d.shows(hdr10Plus) {
		format = hdr10
	}
	if format != sdr && !d.shows(format) {
		vv.transcode = append(vv.transcode, apiv1alpha.PlaybackReason_PLAYBACK_REASON_HDR_FORMAT_UNSUPPORTED)
		return
	}
	vv.outHDR = format
}

func (d *decider) shows(f hdrFormat) bool {
	return slices.Contains(d.caps.GetHdrFormats(), f)
}

func (d *decider) showsDV(profile uint32) bool {
	return d.shows(dolbyVision) && slices.Contains(d.caps.GetDolbyVisionProfiles(), profile)
}

func (d *decider) videoSupport(codec string) *apiv1alpha.VideoCodecSupport {
	for _, s := range d.caps.GetVideoCodecs() {
		if s.GetCodec() == codec {
			return s
		}
	}
	return nil
}

func (d *decider) judgeAudio(s *enginev1alpha.Stream) []reason {
	if s == nil || slices.Contains(d.caps.GetPassthroughCodecs(), s.GetCodec()) {
		return nil
	}
	for _, a := range d.caps.GetAudioCodecs() {
		if a.GetCodec() != s.GetCodec() {
			continue
		}
		if a.GetMaxChannels() != 0 && s.GetAudio().GetChannels() > a.GetMaxChannels() {
			return []reason{apiv1alpha.PlaybackReason_PLAYBACK_REASON_AUDIO_CHANNELS_ABOVE_LIMIT}
		}
		return nil
	}
	return []reason{apiv1alpha.PlaybackReason_PLAYBACK_REASON_AUDIO_CODEC_UNSUPPORTED}
}

// audioTarget picks E-AC-3 for surround the client takes, else AAC or Opus
// stereo.
func (d *decider) audioTarget(s *enginev1alpha.Stream) (string, uint32) {
	channels := s.GetAudio().GetChannels()
	support := func(codec string) (uint32, bool) {
		for _, a := range d.caps.GetAudioCodecs() {
			if a.GetCodec() == codec {
				if a.GetMaxChannels() == 0 {
					return 8, true
				}
				return a.GetMaxChannels(), true
			}
		}
		return 0, false
	}
	if channels > 2 {
		if limit, ok := support("eac3"); ok && limit > 2 {
			return "eac3", min(channels, limit, 8)
		}
	}
	for _, codec := range []string{"aac", "opus"} {
		if _, ok := support(codec); ok {
			return codec, min(max(channels, 1), 2)
		}
	}
	return "aac", min(max(channels, 1), 2)
}

// videoTarget fills in the re-encoded video: the best HDR format and codec
// the client takes, scaled and capped to its limits.
func (d *decider) videoTarget(s *enginev1alpha.Stream, out *apiv1alpha.OutputFormat, warnings *[]apiv1alpha.PlaybackWarning) {
	v := s.GetVideo()
	source := hdrFromEngine(v.GetHdrFormat())
	target := sdr
	if source != sdr && source != apiv1alpha.HdrFormat_HDR_FORMAT_UNSPECIFIED {
		switch {
		case source == dolbyVision && d.showsDV(8):
			target = dolbyVision
		case d.shows(hdr10) || d.shows(hdr10Plus):
			target = hdr10
		}
	}

	// HDR needs 10 bits, which rules H.264 out in practice.
	usable := func(codec string) bool {
		support := d.videoSupport(codec)
		return support != nil && (target == sdr || codec != "h264" && bitDepth(support) >= 10)
	}
	codec := ""
	for _, c := range videoTargets {
		if usable(c) && d.engine.HardwareEncoders[c] {
			codec = c
			break
		}
	}
	if codec == "" {
		// Software: H.264 is the cheapest to encode; HDR needs HEVC.
		for _, c := range []string{"h264", "hevc", "av1"} {
			if usable(c) {
				codec = c
				break
			}
		}
		if codec == "" {
			codec, target = "h264", sdr
		}
		*warnings = append(*warnings, apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_SOFTWARE_TRANSCODE)
	}

	width, height := fit(v.GetWidth(), v.GetHeight(), d.caps.GetMaxWidth(), d.caps.GetMaxHeight())
	if !d.engine.HardwareEncoders[codec] && max(v.GetWidth(), width) >= 3840 {
		*warnings = append(*warnings, apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_SOFTWARE_4K)
	}
	if source != sdr && source != apiv1alpha.HdrFormat_HDR_FORMAT_UNSPECIFIED && target == sdr && !d.engine.TonemapTargets[sdr] {
		*warnings = append(*warnings, apiv1alpha.PlaybackWarning_PLAYBACK_WARNING_TONEMAP_UNAVAILABLE)
	}

	bitrate := bitrateFor(height)
	if m := d.maxBitrate(); m != 0 {
		bitrate = min(bitrate, m)
	}
	if src := d.probe.GetBitRate(); src != 0 {
		bitrate = min(bitrate, src)
	}
	out.VideoCodec, out.HdrFormat, out.Width, out.Height, out.Bitrate = codec, target, width, height, bitrate
}

// fit scales width×height down to fit the limits (zero is no limit),
// keeping the aspect ratio and even dimensions.
func fit(width, height, maxW, maxH uint32) (uint32, uint32) {
	scale := 1.0
	if maxW != 0 && width > maxW {
		scale = min(scale, float64(maxW)/float64(width))
	}
	if maxH != 0 && height > maxH {
		scale = min(scale, float64(maxH)/float64(height))
	}
	if scale == 1 {
		return width, height
	}
	even := func(n float64) uint32 { return uint32(n/2) * 2 }
	return even(float64(width) * scale), even(float64(height) * scale)
}

func bitrateFor(height uint32) uint64 {
	for _, b := range bitrateByHeight {
		if height >= b.height {
			return b.bitrate
		}
	}
	return bitrateByHeight[len(bitrateByHeight)-1].bitrate
}

func bitDepth(s *apiv1alpha.VideoCodecSupport) uint32 {
	if s.GetMaxBitDepth() == 0 {
		return 8
	}
	return s.GetMaxBitDepth()
}

// hdrFromEngine maps the engine's HdrFormat to the client API's; they are
// numbered alike.
func hdrFromEngine(f enginev1alpha.HdrFormat) hdrFormat {
	return apiv1alpha.HdrFormat(f)
}
