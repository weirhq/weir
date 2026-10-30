//! The ffmpeg command line for a session.

use std::path::Path;
use std::time::Duration;

use engine_proto::v1alpha::{AudioOutput, HdrFormat, OutputProfile, VideoOutput};

/// The playlist ffmpeg writes; the engine reads it to learn of segments.
pub const PLAYLIST: &str = "engine.m3u8";
pub const INIT_SEGMENT: &str = "init.mp4";

/// What one run of ffmpeg should do. A seek starts a new run.
pub struct Run<'a> {
    pub input: &'a Path,
    pub output: &'a OutputProfile,
    pub offset: Duration,
    pub segment: Duration,
    pub dir: &'a Path,
    pub start_segment: u32,
}

/// Builds ffmpeg's arguments. Phase 1 encodes in software; hardware paths
/// come with the engine's Phase 2 work.
pub fn ffmpeg_args(run: &Run) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&[
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
    ]);
    if !run.offset.is_zero() {
        // Input seeking: fast, and lands on the keyframe before the offset.
        push(&["-ss", &secs(run.offset)]);
    }
    push(&["-i", &run.input.to_string_lossy()]);

    let out = run.output;
    let video_in = format!("0:{}", out.video_stream);
    match (&out.video, out.burn_in_subtitle_stream) {
        (Some(v), Some(sub)) => {
            let graph = format!("[{video_in}][0:{sub}]overlay{}[v]", scale_filter(v, ","));
            push(&["-filter_complex", &graph, "-map", "[v]"]);
        }
        (Some(v), None) => push(&["-map", &video_in, "-vf", &scale_filter(v, "")]),
        (None, _) => push(&["-map", &video_in]),
    }
    if let Some(audio) = out.audio_stream {
        push(&["-map", &format!("0:{audio}")]);
    }

    match &out.video {
        Some(v) => video_codec_args(v, run.segment, &mut a),
        None => a.extend(["-c:v".into(), "copy".into()]),
    }
    if out.audio_stream.is_some() {
        match &out.audio {
            Some(au) => audio_codec_args(au, &mut a),
            None => a.extend(["-c:a".into(), "copy".into()]),
        }
    }

    let dir = run.dir.to_string_lossy();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&["-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1"]);
    if !run.offset.is_zero() {
        // Keep fMP4 timestamps continuous with the segments before the seek.
        push(&["-output_ts_offset", &secs(run.offset)]);
    }
    push(&[
        "-f",
        "hls",
        "-hls_time",
        &secs(run.segment),
        "-hls_segment_type",
        "fmp4",
        // Fragment decode times from the real timestamps. Without this,
        // ffmpeg starts every run's fragments at zero and hides the offset
        // in the init segment's edit list, which a player keeps from the
        // first run: after a seek, time would restart at zero.
        "-hls_segment_options",
        "movflags=+frag_discont",
        "-hls_fmp4_init_filename",
        INIT_SEGMENT,
        "-hls_segment_filename",
        &format!("{dir}/%d.m4s"),
        "-start_number",
        &run.start_segment.to_string(),
        "-hls_playlist_type",
        "event",
        "-hls_list_size",
        "0",
        "-hls_flags",
        "independent_segments+temp_file",
        &format!("{dir}/{PLAYLIST}"),
    ]);
    a
}

fn scale_filter(v: &VideoOutput, sep: &str) -> String {
    let mut filters = Vec::new();
    if v.width > 0 && v.height > 0 {
        filters.push(format!("scale={}:{}", v.width, v.height));
    }
    let ten_bit = v.hdr_format() != HdrFormat::Sdr && v.hdr_format() != HdrFormat::Unspecified;
    filters.push(format!(
        "format={}",
        if ten_bit { "yuv420p10le" } else { "yuv420p" }
    ));
    format!("{sep}{}", filters.join(","))
}

fn video_codec_args(v: &VideoOutput, segment: Duration, a: &mut Vec<String>) {
    let (encoder, extra): (&str, &[&str]) = match v.codec.as_str() {
        "hevc" => (
            "libx265",
            &[
                "-preset",
                "fast",
                "-tag:v",
                "hvc1",
                "-x265-params",
                "log-level=error",
            ],
        ),
        "av1" => ("libsvtav1", &["-preset", "8"]),
        _ => ("libx264", &["-preset", "veryfast"]),
    };
    a.extend(["-c:v".into(), encoder.into()]);
    a.extend(extra.iter().map(|s| s.to_string()));
    if v.bitrate > 0 {
        a.extend([
            "-b:v".into(),
            v.bitrate.to_string(),
            "-maxrate".into(),
            v.bitrate.to_string(),
            "-bufsize".into(),
            (v.bitrate * 2).to_string(),
        ]);
    }
    // A keyframe at every segment boundary, so segments are the length the
    // server's playlist promises.
    a.extend([
        "-force_key_frames".into(),
        format!("expr:gte(t,n_forced*{})", secs(segment)),
    ]);
}

fn audio_codec_args(au: &AudioOutput, a: &mut Vec<String>) {
    let encoder = match au.codec.as_str() {
        "opus" => "libopus",
        "eac3" => "eac3",
        _ => "aac",
    };
    let channels = au.channels.max(1);
    let bitrate = if au.bitrate > 0 {
        au.bitrate
    } else {
        // 96 kb/s a channel for AAC and Opus stereo; E-AC-3 5.1 at 640.
        match encoder {
            "eac3" => 640_000,
            _ => 96_000 * u64::from(channels.min(2)),
        }
    };
    a.extend([
        "-c:a".into(),
        encoder.into(),
        "-ac".into(),
        channels.to_string(),
        "-b:a".into(),
        bitrate.to_string(),
    ]);
}

fn secs(d: Duration) -> String {
    format!("{:.3}", d.as_secs_f64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn run(output: OutputProfile, offset: u64, start: u32) -> Vec<String> {
        let input = PathBuf::from("/media/film.mkv");
        let dir = PathBuf::from("/seg/s1");
        ffmpeg_args(&Run {
            input: &input,
            output: &output,
            offset: Duration::from_secs(offset),
            segment: Duration::from_secs(6),
            dir: &dir,
            start_segment: start,
        })
    }

    fn has(args: &[String], pair: &[&str]) -> bool {
        args.windows(pair.len())
            .any(|w| w.iter().zip(pair).all(|(a, b)| a == b))
    }

    #[test]
    fn remux_copies_everything() {
        let a = run(
            OutputProfile {
                video_stream: 0,
                audio_stream: Some(1),
                ..Default::default()
            },
            0,
            0,
        );
        assert!(has(&a, &["-map", "0:0"]) && has(&a, &["-map", "0:1"]));
        assert!(has(&a, &["-c:v", "copy"]) && has(&a, &["-c:a", "copy"]));
        assert!(!a.contains(&"-ss".to_string()) && !a.contains(&"-output_ts_offset".to_string()));
        assert!(has(&a, &["-hls_segment_type", "fmp4"]) && has(&a, &["-start_number", "0"]));
        assert_eq!(a.last().unwrap(), "/seg/s1/engine.m3u8");
    }

    #[test]
    fn transcode_scales_and_forces_keyframes() {
        let a = run(
            OutputProfile {
                video_stream: 0,
                audio_stream: Some(1),
                video: Some(VideoOutput {
                    codec: "h264".into(),
                    hdr_format: HdrFormat::Sdr.into(),
                    width: 1920,
                    height: 1080,
                    bitrate: 8_000_000,
                }),
                audio: Some(AudioOutput {
                    codec: "aac".into(),
                    channels: 2,
                    bitrate: 0,
                }),
                ..Default::default()
            },
            0,
            0,
        );
        assert!(has(&a, &["-vf", "scale=1920:1080,format=yuv420p"]));
        assert!(has(&a, &["-c:v", "libx264"]) && has(&a, &["-b:v", "8000000"]));
        assert!(has(&a, &["-force_key_frames", "expr:gte(t,n_forced*6.000)"]));
        assert!(has(&a, &["-c:a", "aac", "-ac", "2", "-b:a", "192000"]));
    }

    #[test]
    fn hevc_hdr_is_ten_bit_and_tagged_for_apple() {
        let a = run(
            OutputProfile {
                video_stream: 0,
                video: Some(VideoOutput {
                    codec: "hevc".into(),
                    hdr_format: HdrFormat::Hdr10.into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            0,
            0,
        );
        assert!(has(&a, &["-vf", "format=yuv420p10le"]) && has(&a, &["-tag:v", "hvc1"]));
        assert!(
            !a.contains(&"-c:a".to_string()),
            "no audio stream, no audio codec"
        );
    }

    #[test]
    fn burn_in_overlays_the_subtitle() {
        let a = run(
            OutputProfile {
                video_stream: 0,
                burn_in_subtitle_stream: Some(3),
                video: Some(VideoOutput {
                    codec: "h264".into(),
                    hdr_format: HdrFormat::Sdr.into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            0,
            0,
        );
        assert!(has(
            &a,
            &[
                "-filter_complex",
                "[0:0][0:3]overlay,format=yuv420p[v]",
                "-map",
                "[v]"
            ]
        ));
    }

    #[test]
    fn a_seek_offsets_input_and_timestamps_and_renumbers() {
        let a = run(
            OutputProfile {
                video_stream: 0,
                ..Default::default()
            },
            90,
            15,
        );
        let ss = a.iter().position(|s| s == "-ss").unwrap();
        let i = a.iter().position(|s| s == "-i").unwrap();
        assert!(ss < i, "-ss must come before -i to seek the input");
        assert!(has(&a, &["-ss", "90.000"]) && has(&a, &["-output_ts_offset", "90.000"]));
        assert!(has(&a, &["-hls_segment_options", "movflags=+frag_discont"]));
        assert!(has(&a, &["-start_number", "15"]));
    }
}
