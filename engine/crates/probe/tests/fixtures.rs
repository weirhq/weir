use engine_proto::v1alpha::{HdrFormat, StreamKind, stream::Detail};
use probe::from_ffprobe_json;

const HDR10: &[u8] = include_bytes!("fixtures/hdr10.json");
const DV_P8: &[u8] = include_bytes!("fixtures/dv_p8.json");
const MUSIC: &[u8] = include_bytes!("fixtures/music.json");

fn video(resp: &engine_proto::v1alpha::ProbeResponse) -> &engine_proto::v1alpha::VideoDetail {
    match &resp.streams[0].detail {
        Some(Detail::Video(v)) => v,
        other => panic!("stream 0 is not video: {other:?}"),
    }
}

#[test]
fn hdr10_mkv() {
    let resp = from_ffprobe_json(HDR10).unwrap();
    assert_eq!(resp.container, "matroska,webm");
    assert_eq!(resp.duration.unwrap().seconds, 2);
    assert_eq!(resp.streams.len(), 3);
    assert_eq!(resp.chapters.len(), 2);
    assert_eq!(resp.chapters[1].title, "Credits");
    assert_eq!(resp.chapters[1].start.unwrap().seconds, 1);

    let v = video(&resp);
    assert_eq!(resp.streams[0].codec, "hevc");
    assert_eq!(resp.streams[0].profile, "Main 10");
    assert_eq!((v.width, v.height, v.bit_depth), (320, 180, 10));
    assert_eq!(v.frame_rate.unwrap().numerator, 24000);
    assert_eq!(v.hdr_format(), HdrFormat::Hdr10);
    assert_eq!(v.color_primaries, "bt2020");
    assert_eq!(v.color_matrix, "bt2020nc");
    assert!(v.dolby_vision.is_none());

    let audio = &resp.streams[1];
    assert_eq!(audio.kind(), StreamKind::Audio);
    assert_eq!(audio.language, "en");
    let Some(Detail::Audio(a)) = &audio.detail else {
        panic!("not audio")
    };
    assert_eq!((a.channels, a.channel_layout.as_str()), (6, "5.1(side)"));
    assert!(!a.atmos);

    let sub = &resp.streams[2];
    assert_eq!((sub.language.as_str(), sub.title.as_str()), ("fr", "Français"));
    assert!(sub.flags.unwrap().forced);
    assert_eq!(sub.detail, Some(Detail::Subtitle(Default::default())));
}

#[test]
fn dolby_vision_profile_8() {
    let resp = from_ffprobe_json(DV_P8).unwrap();
    let v = video(&resp);
    assert_eq!(v.hdr_format(), HdrFormat::DolbyVision);
    let dv = v.dolby_vision.unwrap();
    assert_eq!((dv.profile, dv.level, dv.bl_compat_id), (8, 6, 1));
    assert!(dv.rpu_present && dv.bl_present && !dv.el_present);

    let md = v.mastering_display.unwrap();
    assert_eq!(md.red.unwrap().x, 0.68);
    assert_eq!(md.white_point.unwrap().y, 0.329);
    assert_eq!((md.min_luminance, md.max_luminance), (0.005, 1000.0));
    let cl = v.content_light.unwrap();
    assert_eq!((cl.max_cll, cl.max_fall), (1000, 400));

    let Some(Detail::Audio(a)) = &resp.streams[1].detail else {
        panic!("not audio")
    };
    assert!(a.atmos);
    assert_eq!((a.channels, a.bit_depth), (8, 24));
    assert!(resp.streams[1].flags.unwrap().default);

    let pgs = &resp.streams[3];
    assert_eq!(pgs.language, "de");
    assert!(pgs.flags.unwrap().hearing_impaired);
    assert_eq!(
        pgs.detail,
        Some(Detail::Subtitle(engine_proto::v1alpha::SubtitleDetail {
            image_based: true
        }))
    );

    // The font is an attachment, not a stream.
    assert_eq!(resp.streams.len(), 4);
    assert_eq!(resp.attachments.len(), 1);
    assert_eq!(resp.attachments[0].filename, "Arial.ttf");
    assert_eq!(resp.attachments[0].mime_type, "font/ttf");
}

#[test]
fn flac_with_replaygain() {
    let resp = from_ffprobe_json(MUSIC).unwrap();
    assert_eq!(resp.container, "flac");
    let Some(Detail::Audio(a)) = &resp.streams[0].detail else {
        panic!("not audio")
    };
    assert_eq!((a.sample_rate, a.bit_depth, a.channels), (44100, 16, 1));
    let rg = a.replay_gain.unwrap();
    assert_eq!(rg.track_gain_db, Some(-6.48));
    assert_eq!(rg.album_gain_db, Some(-7.10));
    assert_eq!(rg.track_peak, Some(0.988525));
    assert_eq!(resp.tags["title"], "Test Tone");
    assert_eq!(resp.tags["replaygain_track_gain"], "-6.48 dB");
}

#[test]
fn probe_hash_is_stable_and_content_sensitive() {
    let a = from_ffprobe_json(HDR10).unwrap().probe_hash;
    assert_eq!(a.len(), 64);
    assert_eq!(a, from_ffprobe_json(HDR10).unwrap().probe_hash);
    assert_ne!(a, from_ffprobe_json(DV_P8).unwrap().probe_hash);
}

#[test]
fn tolerates_missing_fields() {
    let resp = from_ffprobe_json(br#"{"streams":[{"index":0}]}"#).unwrap();
    assert_eq!(resp.streams[0].kind(), StreamKind::Data);
    assert!(resp.duration.is_none());
}
