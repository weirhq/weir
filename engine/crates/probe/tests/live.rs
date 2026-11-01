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
async fn copies_out_cover_art() {
    if !have("ffmpeg") || !have("ffprobe") {
        eprintln!("ffmpeg or ffprobe not on PATH; skipping");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let cover = dir.path().join("cover.png");
    let file = dir.path().join("track.flac");
    let ffmpeg = |args: &[&str]| {
        let status = Command::new("ffmpeg")
            .args(["-v", "error"])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success());
    };
    ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "color=red:size=32x32",
        "-frames:v",
        "1",
        cover.to_str().unwrap(),
    ]);
    // FLAC with the PNG as its front cover, the way taggers write it.
    ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "sine=duration=0.2",
        "-i",
        cover.to_str().unwrap(),
        "-map",
        "0:a",
        "-map",
        "1:v",
        "-c:a",
        "flac",
        "-c:v",
        "copy",
        "-disposition:v",
        "attached_pic",
        file.to_str().unwrap(),
    ]);

    let resp = probe::probe(Path::new("ffprobe"), &file).await.unwrap();
    let pic = resp.attachments.first().expect("the cover is listed");
    assert_eq!(pic.mime_type, "image/png");
    let data = probe::picture(Path::new("ffmpeg"), &file, pic.index)
        .await
        .unwrap();
    assert_eq!(data, std::fs::read(&cover).unwrap(), "copied as stored");
    assert!(matches!(
        probe::picture(Path::new("ffmpeg"), &file, 0).await,
        Err(probe::Error::NoPicture { .. })
    ));
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
