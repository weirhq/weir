//! The subset of `ffprobe -print_format json` output the probe reads.
//! ffprobe prints most numbers as strings, so those fields are strings here.

use std::collections::HashMap;

use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
pub struct Output {
    #[serde(default)]
    pub format: Format,
    #[serde(default)]
    pub streams: Vec<Stream>,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Format {
    pub format_name: Option<String>,
    pub duration: Option<String>,
    pub size: Option<String>,
    pub bit_rate: Option<String>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Stream {
    pub index: u32,
    pub codec_type: Option<String>,
    pub codec_name: Option<String>,
    pub profile: Option<String>,
    pub level: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub r_frame_rate: Option<String>,
    pub avg_frame_rate: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_range: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub bits_per_raw_sample: Option<String>,
    pub bits_per_sample: Option<u32>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    pub sample_rate: Option<String>,
    #[serde(default)]
    pub disposition: HashMap<String, u8>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
    #[serde(default)]
    pub side_data_list: Vec<SideData>,
}

/// One entry of a stream's side_data_list. Its fields depend on the type, so
/// they stay as raw JSON.
#[derive(Debug, Deserialize)]
pub struct SideData {
    pub side_data_type: String,
    #[serde(flatten)]
    pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct Chapter {
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}
