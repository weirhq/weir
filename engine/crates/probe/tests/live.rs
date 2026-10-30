//! Runs the real ffprobe against a file made by ffmpeg. Skips when either
//! binary is missing from PATH (as in Bazel's sandbox).

use std::path::Path;
use std::process::Command;

use engine_proto::v1alpha::StreamKind;

fn have(bin: &str) -> bool {
    Command::new(bin)
        .arg("-version")
        .output()
        .is_ok_and(|o| o.status.success())
}

#[tokio::test]
async fn probes_a_real_file() {
    if !have("ffmpeg") || !have("ffprobe") {
        eprintln!("ffmpeg or ffprobe not on PATH; skipping");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("clip.mkv");
    // Encoders built into every ffmpeg, so this works without optional libraries.
    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x64:rate=25:duration=0.2",
        ])
        .args([
            "-f",
            "lavfi",
            "-i",
            "sine=duration=0.2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "flac",
        ])
        .arg(&file)
        .status()
        .unwrap();
    assert!(status.success());

    let resp = probe::probe(Path::new("ffprobe"), &file).await.unwrap();
    let kinds: Vec<_> = resp.streams.iter().map(|s| s.kind()).collect();
    assert_eq!(kinds, [StreamKind::Video, StreamKind::Audio]);
    assert!(
        !probe::ffprobe_version(Path::new("ffprobe"))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn rejects_relative_and_missing_paths() {
    let ffprobe = Path::new("ffprobe");
    assert!(matches!(
        probe::probe(ffprobe, Path::new("clip.mkv")).await,
        Err(probe::Error::RelativePath(_))
    ));
    assert!(matches!(
        probe::probe(ffprobe, Path::new("/nonexistent/clip.mkv")).await,
        Err(probe::Error::NotFound(_))
    ));
}
