//! Reading the playlist ffmpeg's HLS muxer writes.

use std::time::Duration;

/// A segment listed in ffmpeg's playlist.
#[derive(Debug, PartialEq)]
pub struct Segment {
    pub index: u32,
    pub file: String,
    pub duration: Duration,
}

/// Parsed playlist: the segments so far, and whether ffmpeg has finished.
#[derive(Debug, Default, PartialEq)]
pub struct Playlist {
    pub segments: Vec<Segment>,
    pub ended: bool,
}

/// Parses an HLS media playlist. Segment numbers come from the file names
/// ("15.m4s"), which follow -start_number.
pub fn parse(text: &str) -> Playlist {
    let mut playlist = Playlist::default();
    let mut duration = None;
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let secs = rest.split(',').next().unwrap_or_default();
            duration = secs.parse::<f64>().ok().map(Duration::from_secs_f64);
        } else if line == "#EXT-X-ENDLIST" {
            playlist.ended = true;
        } else if !line.is_empty()
            && !line.starts_with('#')
            && let (Some(d), Some(index)) = (
                duration.take(),
                line.strip_suffix(".m4s").and_then(|n| n.parse().ok()),
            )
        {
            playlist.segments.push(Segment {
                index,
                file: line.to_string(),
                duration: d,
            });
        }
    }
    playlist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_fmp4_playlist() {
        let p = parse(
            "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:15\n\
             #EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI=\"init.mp4\"\n\
             #EXTINF:6.006000,\n15.m4s\n#EXTINF:5.005000,\n16.m4s\n",
        );
        assert_eq!(p.segments.len(), 2);
        assert_eq!(
            p.segments[0],
            Segment {
                index: 15,
                file: "15.m4s".into(),
                duration: Duration::from_secs_f64(6.006)
            }
        );
        assert!(!p.ended);
        assert!(parse("#EXTINF:1.0,\n0.m4s\n#EXT-X-ENDLIST\n").ended);
    }

    #[test]
    fn ignores_half_written_entries() {
        assert!(parse("#EXTINF:6.0,\n").segments.is_empty());
        assert!(parse("#EXTINF:6.0,\nnot-a-segment.ts\n").segments.is_empty());
    }
}
