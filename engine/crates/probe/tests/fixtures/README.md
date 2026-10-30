# Probe fixtures

`hdr10.json` and `music.json` are real `ffprobe -print_format json
-show_format -show_streams -show_chapters` output (ffprobe 9.0.2) for small
files made with ffmpeg's `testsrc2` and `sine` sources: a 10-bit HEVC
HDR10 MKV with E-AC-3 5.1, an ASS subtitle and two chapters, and a FLAC
track with ReplayGain tags.

`dv_p8.json` is derived from `hdr10.json`, because ffmpeg can't author Dolby
Vision. It adds the stream side data ffprobe reports for a profile 8.1 remux
(DOVI configuration record, mastering display, content light level), turns
the audio into TrueHD Atmos 7.1, and adds a PGS subtitle and a font
attachment. Field names follow ffprobe's JSON writer.
