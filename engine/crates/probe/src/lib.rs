//! Stream inventory for one media file, and the pictures embedded in it.
//!
//! Phase 0 reads `ffprobe -print_format json`. Parsing Dolby Vision RPUs and
//! HDR10+ metadata beyond what ffprobe reports comes with the ffmpeg-next
//! probe in Phase 2.

mod ffprobe;
pub mod language;
mod map;

use std::path::{Path, PathBuf};

use engine_proto::v1alpha::ProbeResponse;
use tokio::process::Command;

pub use map::from_ffprobe_json;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0} is not an absolute path")]
    RelativePath(PathBuf),
    #[error("{0}: no such file")]
    NotFound(PathBuf),
    #[error("run {program}: {source}")]
    Spawn {
        program: PathBuf,
        source: std::io::Error,
    },
    #[error("ffprobe could not read {path}: {stderr}")]
    Unreadable { path: PathBuf, stderr: String },
    #[error("parse ffprobe output: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("{path} has no picture at stream {index}: {stderr}")]
    NoPicture {
        path: PathBuf,
        index: u32,
        stderr: String,
    },
    #[error("{path} has no text subtitle at stream {index}: {stderr}")]
    NoSubtitle {
        path: PathBuf,
        index: u32,
        stderr: String,
    },
}

/// Probes the file at `path` with the ffprobe binary at `ffprobe`.
pub async fn probe(ffprobe: &Path, path: &Path) -> Result<ProbeResponse, Error> {
    check_path(path).await?;
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
        ])
        .arg(path)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|source| Error::Spawn {
            program: ffprobe.to_owned(),
            source,
        })?;
    if !output.status.success() {
        return Err(Error::Unreadable {
            path: path.to_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(from_ffprobe_json(&output.stdout)?)
}

/// Copies the picture at stream `index` of `path` (cover art, an image
/// stream marked attached_pic) as it's stored, with the ffmpeg binary at
/// `ffmpeg`.
pub async fn picture(ffmpeg: &Path, path: &Path, index: u32) -> Result<Vec<u8>, Error> {
    check_path(path).await?;
    let output = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        // Without audio, subtitles and data, an index that isn't a picture
        // leaves ffmpeg nothing to write, and it fails.
        .args(["-map", &format!("0:{index}"), "-an", "-sn", "-dn"])
        .args(["-c", "copy", "-frames:v", "1"])
        .args(["-f", "image2pipe", "pipe:1"])
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|source| Error::Spawn {
            program: ffmpeg.to_owned(),
            source,
        })?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err(Error::NoPicture {
            path: path.to_owned(),
            index,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(output.stdout)
}

/// Converts the text subtitle at stream `index` of `path` to WebVTT, timed
/// from the start of the file, with the ffmpeg binary at `ffmpeg`. ffmpeg
/// reads the whole file to find every cue.
pub async fn subtitle_webvtt(ffmpeg: &Path, path: &Path, index: u32) -> Result<String, Error> {
    check_path(path).await?;
    let output = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-map", &format!("0:{index}"), "-c:s", "webvtt"])
        .args(["-f", "webvtt", "pipe:1"])
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|source| Error::Spawn {
            program: ffmpeg.to_owned(),
            source,
        })?;
    if !output.status.success() || !output.stdout.starts_with(b"WEBVTT") {
        return Err(Error::NoSubtitle {
            path: path.to_owned(),
            index,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn check_path(path: &Path) -> Result<(), Error> {
    if !path.is_absolute() {
        return Err(Error::RelativePath(path.to_owned()));
    }
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Err(Error::NotFound(path.to_owned()));
    }
    Ok(())
}

/// The version string ffprobe reports, e.g. "9.0.2".
pub async fn ffprobe_version(ffprobe: &Path) -> Result<String, Error> {
    let output = Command::new(ffprobe)
        .arg("-version")
        .output()
        .await
        .map_err(|source| Error::Spawn {
            program: ffprobe.to_owned(),
            source,
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("ffprobe version "))
        .and_then(|rest| rest.split_whitespace().next())
        .unwrap_or_default()
        .to_string())
}
