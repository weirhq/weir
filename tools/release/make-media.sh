#!/usr/bin/env bash
# Writes the smoke test's films into <folder>: one that direct-plays
# (H.264/AAC MP4) and one that makes the engine transcode (HEVC/FLAC MKV).
# The release workflow uses the tarball's ffmpeg, which has both encoders.
#
#   make-media.sh <ffmpeg> <folder>
set -euo pipefail

ffmpeg=$1 out=$2
mkdir -p "$out/films/Arrival (2016)" "$out/films/Zodiac (2007)"

src=(-f lavfi -i testsrc2=size=1280x720:rate=24:duration=30 -f lavfi -i sine=duration=30)
"$ffmpeg" -hide_banner -loglevel error -y "${src[@]}" \
    -c:v libx264 -pix_fmt yuv420p -c:a aac "$out/films/Arrival (2016)/Arrival (2016).mp4"
"$ffmpeg" -hide_banner -loglevel error -y "${src[@]}" \
    -c:v libx265 -pix_fmt yuv420p -c:a flac "$out/films/Zodiac (2007)/Zodiac (2007).mkv"
# The containers' users read it as "other".
chmod -R a+rX "$out"
