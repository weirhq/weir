//! Playback sessions: one ffmpeg process each, writing fMP4 HLS.

pub mod args;
pub mod playlist;
pub mod runner;

pub use runner::{Command, Limits, Spec, run};
