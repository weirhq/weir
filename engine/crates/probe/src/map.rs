//! ffprobe JSON to ProbeResponse.

use std::collections::HashMap;

use engine_proto::v1alpha::{
    Attachment, AudioDetail, Chapter, Chromaticity, ContentLight, DolbyVision, HdrFormat, MasteringDisplay,
    ProbeResponse, Rational, ReplayGain, Stream, StreamFlags, StreamKind, SubtitleDetail, VideoDetail,
    stream,
};
use prost::Message;
use sha2::{Digest, Sha256};

use crate::ffprobe::{self, SideData};
use crate::language;

const DOVI_RECORD: &str = "DOVI configuration record";
const MASTERING_DISPLAY: &str = "Mastering display metadata";
const CONTENT_LIGHT: &str = "Content light level metadata";

const IMAGE_SUBTITLE_CODECS: [&str; 4] = ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"];

/// Parses ffprobe's JSON and fills in the probe hash.
pub fn from_ffprobe_json(json: &[u8]) -> Result<ProbeResponse, serde_json::Error> {
    let out: ffprobe::Output = serde_json::from_slice(json)?;
    let mut resp = ProbeResponse {
        probe_hash: String::new(),
        container: out.format.format_name.clone().unwrap_or_default(),
        duration: seconds(out.format.duration.as_deref()),
        size_bytes: parse(out.format.size.as_deref()).unwrap_or(0),
        bit_rate: parse(out.format.bit_rate.as_deref()).unwrap_or(0),
        streams: Vec::new(),
        chapters: out.chapters.iter().map(chapter).collect(),
        attachments: Vec::new(),
        // Lowercased: FLAC writes "TITLE", Matroska "title".
        tags: out
            .format
            .tags
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
            .collect(),
    };
    for s in &out.streams {
        match s.codec_type.as_deref() {
            Some("attachment") => resp.attachments.push(attachment(s)),
            // Cover art: an image, not a video stream.
            Some("video") if flag(s, "attached_pic") => resp.attachments.push(attachment(s)),
            _ => resp.streams.push(stream(s, &out.format.tags)),
        }
    }
    resp.probe_hash = hash(&resp);
    Ok(resp)
}

/// SHA-256 of the response with an empty hash field. The encoding is
/// deterministic for a given message, so equal probes hash equally.
fn hash(resp: &ProbeResponse) -> String {
    let digest = Sha256::digest(resp.encode_to_vec());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn stream(s: &ffprobe::Stream, format_tags: &HashMap<String, String>) -> Stream {
    let (kind, detail) = match s.codec_type.as_deref() {
        Some("video") => (StreamKind::Video, Some(stream::Detail::Video(video(s)))),
        Some("audio") => (
            StreamKind::Audio,
            Some(stream::Detail::Audio(audio(s, format_tags))),
        ),
        Some("subtitle") => (StreamKind::Subtitle, Some(stream::Detail::Subtitle(subtitle(s)))),
        _ => (StreamKind::Data, None),
    };
    Stream {
        index: s.index,
        kind: kind.into(),
        codec: s.codec_name.clone().unwrap_or_default(),
        profile: s.profile.clone().unwrap_or_default(),
        language: tag(&s.tags, "language")
            .map(language::to_bcp47)
            .unwrap_or_default(),
        title: tag(&s.tags, "title").unwrap_or_default().to_string(),
        flags: Some(StreamFlags {
            default: flag(s, "default"),
            forced: flag(s, "forced"),
            hearing_impaired: flag(s, "hearing_impaired"),
            visual_impaired: flag(s, "visual_impaired"),
            commentary: flag(s, "comment"),
        }),
        detail,
    }
}

fn video(s: &ffprobe::Stream) -> VideoDetail {
    let dovi = side_data(s, DOVI_RECORD).map(dolby_vision);
    let transfer = s.color_transfer.clone().unwrap_or_default();
    let hdr_format = if dovi.is_some() {
        HdrFormat::DolbyVision
    } else if transfer == "smpte2084" {
        HdrFormat::Hdr10
    } else if transfer == "arib-std-b67" {
        HdrFormat::Hlg
    } else {
        HdrFormat::Sdr
    };
    let frame_rate = rational(s.avg_frame_rate.as_deref()).or_else(|| rational(s.r_frame_rate.as_deref()));
    VideoDetail {
        width: s.width.unwrap_or(0),
        height: s.height.unwrap_or(0),
        frame_rate,
        level: s.level.and_then(|l| u32::try_from(l).ok()).unwrap_or(0),
        bit_depth: parse(s.bits_per_raw_sample.as_deref())
            .unwrap_or_else(|| pix_fmt_depth(s.pix_fmt.as_deref())),
        pixel_format: s.pix_fmt.clone().unwrap_or_default(),
        color_primaries: s.color_primaries.clone().unwrap_or_default(),
        color_transfer: transfer,
        color_matrix: s.color_space.clone().unwrap_or_default(),
        color_range: s.color_range.clone().unwrap_or_default(),
        hdr_format: hdr_format.into(),
        dolby_vision: dovi,
        mastering_display: side_data(s, MASTERING_DISPLAY).map(mastering_display),
        content_light: side_data(s, CONTENT_LIGHT).map(|sd| ContentLight {
            max_cll: field_u32(sd, "max_content"),
            max_fall: field_u32(sd, "max_average"),
        }),
        hdr10_plus: s
            .side_data_list
            .iter()
            .any(|sd| sd.side_data_type.contains("HDR10+")),
    }
}

fn dolby_vision(sd: &SideData) -> DolbyVision {
    DolbyVision {
        profile: field_u32(sd, "dv_profile"),
        level: field_u32(sd, "dv_level"),
        bl_compat_id: field_u32(sd, "dv_bl_signal_compatibility_id"),
        rpu_present: field_u32(sd, "rpu_present_flag") == 1,
        el_present: field_u32(sd, "el_present_flag") == 1,
        bl_present: field_u32(sd, "bl_present_flag") == 1,
    }
}

fn mastering_display(sd: &SideData) -> MasteringDisplay {
    let point = |c: &str| Chromaticity {
        x: field_ratio(sd, &format!("{c}_x")),
        y: field_ratio(sd, &format!("{c}_y")),
    };
    MasteringDisplay {
        red: Some(point("red")),
        green: Some(point("green")),
        blue: Some(point("blue")),
        white_point: Some(point("white_point")),
        min_luminance: field_ratio(sd, "min_luminance"),
        max_luminance: field_ratio(sd, "max_luminance"),
    }
}

fn audio(s: &ffprobe::Stream, format_tags: &HashMap<String, String>) -> AudioDetail {
    let profile = s.profile.as_deref().unwrap_or_default();
    AudioDetail {
        channels: s.channels.unwrap_or(0),
        channel_layout: s.channel_layout.clone().unwrap_or_default(),
        sample_rate: parse(s.sample_rate.as_deref()).unwrap_or(0),
        bit_depth: parse(s.bits_per_raw_sample.as_deref())
            .or(s.bits_per_sample.filter(|&b| b > 0))
            .unwrap_or(0),
        atmos: profile.contains("Atmos"),
        dts_x: profile.contains("DTS:X"),
        // Stream tags win; FLAC and MP3 keep ReplayGain in the file's tags.
        replay_gain: replay_gain(&s.tags).or_else(|| replay_gain(format_tags)),
    }
}

fn replay_gain(tags: &HashMap<String, String>) -> Option<ReplayGain> {
    let value =
        |key: &str| tag(tags, key).and_then(|v| v.trim().trim_end_matches("dB").trim().parse::<f64>().ok());
    let rg = ReplayGain {
        track_gain_db: value("REPLAYGAIN_TRACK_GAIN"),
        track_peak: value("REPLAYGAIN_TRACK_PEAK"),
        album_gain_db: value("REPLAYGAIN_ALBUM_GAIN"),
        album_peak: value("REPLAYGAIN_ALBUM_PEAK"),
    };
    (rg != ReplayGain::default()).then_some(rg)
}

fn subtitle(s: &ffprobe::Stream) -> SubtitleDetail {
    SubtitleDetail {
        image_based: IMAGE_SUBTITLE_CODECS.contains(&s.codec_name.as_deref().unwrap_or_default()),
    }
}

fn attachment(s: &ffprobe::Stream) -> Attachment {
    let mime =
        tag(&s.tags, "mimetype")
            .map(str::to_string)
            .unwrap_or_else(|| match s.codec_name.as_deref() {
                Some("mjpeg") => "image/jpeg".into(),
                Some("png") => "image/png".into(),
                _ => String::new(),
            });
    Attachment {
        index: s.index,
        filename: tag(&s.tags, "filename").unwrap_or_default().to_string(),
        mime_type: mime,
    }
}

fn chapter(c: &ffprobe::Chapter) -> Chapter {
    Chapter {
        start: seconds(c.start_time.as_deref()),
        end: seconds(c.end_time.as_deref()),
        title: tag(&c.tags, "title").unwrap_or_default().to_string(),
    }
}

fn flag(s: &ffprobe::Stream, name: &str) -> bool {
    s.disposition.get(name).is_some_and(|&v| v == 1)
}

/// Tag lookup ignoring case: Matroska writes "title", FLAC "TITLE".
fn tag<'a>(tags: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    tags.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

fn side_data<'a>(s: &'a ffprobe::Stream, kind: &str) -> Option<&'a SideData> {
    s.side_data_list.iter().find(|sd| sd.side_data_type == kind)
}

fn field_u32(sd: &SideData, name: &str) -> u32 {
    sd.fields
        .get(name)
        .and_then(serde_json::Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or(0)
}

/// Side data rationals come as "34000/50000" strings.
fn field_ratio(sd: &SideData, name: &str) -> f64 {
    match sd.fields.get(name) {
        Some(serde_json::Value::String(s)) => match s.split_once('/') {
            Some((n, d)) => match (n.parse::<f64>(), d.parse::<f64>()) {
                (Ok(n), Ok(d)) if d != 0.0 => n / d,
                _ => 0.0,
            },
            None => s.parse().unwrap_or(0.0),
        },
        Some(v) => v.as_f64().unwrap_or(0.0),
        None => 0.0,
    }
}

fn parse<T: std::str::FromStr>(s: Option<&str>) -> Option<T> {
    s.and_then(|s| s.parse().ok())
}

fn seconds(s: Option<&str>) -> Option<prost_types::Duration> {
    let secs: f64 = parse(s)?;
    if !secs.is_finite() || secs < 0.0 {
        return None;
    }
    Some(prost_types::Duration {
        seconds: secs.trunc() as i64,
        nanos: (secs.fract() * 1e9).round() as i32,
    })
}

fn rational(s: Option<&str>) -> Option<Rational> {
    let (n, d) = s?.split_once('/')?;
    let (numerator, denominator) = (n.parse().ok()?, d.parse().ok()?);
    (numerator != 0 && denominator != 0).then_some(Rational {
        numerator,
        denominator,
    })
}

/// Bit depth from a pixel format name such as "yuv420p10le".
fn pix_fmt_depth(pix_fmt: Option<&str>) -> u32 {
    let Some(fmt) = pix_fmt else { return 0 };
    ["p16", "p12", "p10"]
        .iter()
        .find(|depth| fmt.contains(*depth))
        .map_or(8, |depth| depth[1..].parse().unwrap_or(8))
}
