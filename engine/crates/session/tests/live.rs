//! A real ffmpeg session on a generated clip. Skips when ffmpeg isn't on
//! PATH (as in Bazel's sandbox).

use std::path::PathBuf;
use std::process::Command as Process;
use std::time::Duration;

use engine_proto::v1alpha::session_event::Event;
use engine_proto::v1alpha::{AudioOutput, HdrFormat, OutputProfile, VideoOutput};
use session::{Limits, Spec, run};
use tokio::sync::mpsc;

fn have_ffmpeg() -> bool {
    Process::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok_and(|o| o.status.success())
}

fn clip(dir: &std::path::Path, seconds: u32) -> PathBuf {
    let path = dir.join("clip.mkv");
    let status = Process::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc=size=160x90:rate=25:duration={seconds}"),
        ])
        .args([
            "-f",
            "lavfi",
            "-i",
            &format!("sine=duration={seconds}"),
            "-c:v",
            "mpeg4",
            "-c:a",
            "flac",
        ])
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    path
}

fn spec(input: PathBuf, dir: PathBuf) -> Spec {
    Spec {
        ffmpeg: PathBuf::from("ffmpeg"),
        input,
        output: OutputProfile {
            video_stream: 0,
            audio_stream: Some(1),
            video: Some(VideoOutput {
                codec: "h264".into(),
                hdr_format: HdrFormat::Sdr.into(),
                width: 160,
                height: 90,
                bitrate: 300_000,
            }),
            audio: Some(AudioOutput {
                codec: "aac".into(),
                channels: 2,
                bitrate: 0,
            }),
            ..Default::default()
        },
        offset: Duration::ZERO,
        segment: Duration::from_secs(1),
        dir,
        start_segment: 0,
    }
}

#[tokio::test]
async fn transcodes_a_clip_to_hls() {
    if !have_ffmpeg() {
        eprintln!("ffmpeg not on PATH; skipping");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("session");
    std::fs::create_dir(&out).unwrap();
    let (_commands, rx) = mpsc::channel(8);
    let (tx, mut events) = mpsc::channel(64);
    tokio::spawn(run(
        spec(clip(tmp.path(), 3), out.clone()),
        Limits::default(),
        rx,
        tx,
    ));

    let mut segments = Vec::new();
    let mut ready = false;
    while let Some(e) = tokio::time::timeout(Duration::from_secs(30), events.recv())
        .await
        .unwrap()
    {
        match e.event.unwrap() {
            Event::Ready(r) => ready = std::fs::metadata(&r.init_segment).is_ok_and(|m| m.len() > 0),
            Event::Segment(s) => {
                assert!(std::path::Path::new(&s.path).exists());
                segments.push(s.index);
            }
            Event::Finished(_) => break,
            Event::Failed(f) => panic!("failed: {}", f.message),
            _ => {}
        }
    }
    assert!(ready, "no init segment");
    assert_eq!(segments, [0, 1, 2], "one-second segments of a three-second clip");
}

// What a seek restarts with: real ffmpeg must start at the offset and number
// segments from start_segment. (The restart itself is tested with a fake
// ffmpeg in runner.rs; a real one finishes these clips too fast to catch.)
#[tokio::test]
async fn starting_at_an_offset_continues_the_numbering() {
    if !have_ffmpeg() {
        eprintln!("ffmpeg not on PATH; skipping");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("session");
    std::fs::create_dir(&out).unwrap();
    let (_commands, rx) = mpsc::channel(8);
    let (tx, mut events) = mpsc::channel(64);
    let mut spec = spec(clip(tmp.path(), 6), out);
    spec.offset = Duration::from_secs(4);
    spec.start_segment = 4;
    tokio::spawn(run(spec, Limits::default(), rx, tx));

    let mut segments = Vec::new();
    while let Some(e) = tokio::time::timeout(Duration::from_secs(30), events.recv())
        .await
        .unwrap()
    {
        match e.event.unwrap() {
            Event::Segment(s) => segments.push(s.index),
            Event::Finished(_) => break,
            Event::Failed(f) => panic!("failed: {}", f.message),
            _ => {}
        }
    }
    assert_eq!(segments, [4, 5], "the last two seconds, numbered from 4");
}
