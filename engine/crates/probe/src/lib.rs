//! Stream inventory for one media file.
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
    #[error("run {ffprobe}: {source}")]
    Spawn {
        ffprobe: PathBuf,
        source: std::io::Error,
    },
    #[error("ffprobe could not read {path}: {stderr}")]
    Unreadable { path: PathBuf, stderr: String },
    #[error("parse ffprobe output: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Probes the file at `path` with the ffprobe binary at `ffprobe`.
pub async fn probe(ffprobe: &Path, path: &Path) -> Result<ProbeResponse, Error> {
    if !path.is_absolute() {
        return Err(Error::RelativePath(path.to_owned()));
    }
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Err(Error::NotFound(path.to_owned()));
    }
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
            ffprobe: ffprobe.to_owned(),
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

/// The version string ffprobe reports, e.g. "9.0.2".
pub async fn ffprobe_version(ffprobe: &Path) -> Result<String, Error> {
    let output = Command::new(ffprobe)
        .arg("-version")
        .output()
        .await
        .map_err(|source| Error::Spawn {
            ffprobe: ffprobe.to_owned(),
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
