#!/usr/bin/env bash
# Pins the ffmpeg release named by third_party/ffmpeg/source.env: downloads
# each tarball, hashes it, and rewrites the ffmpeg block in MODULE.bazel and
# third_party/ffmpeg/BUILD.bazel. Commit both afterwards.
#
#   tools/ffmpeg/pin.sh            # releases from weirhq/weir
#   WEIR_REPO=me/weir tools/ffmpeg/pin.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=../../third_party/ffmpeg/source.env
source third_party/ffmpeg/source.env
repo=${WEIR_REPO:-weirhq/weir}
tag="ffmpeg-${FFMPEG_VERSION}-${BUILD_REVISION}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

block="# BEGIN ffmpeg (written by tools/ffmpeg/pin.sh; see docs/runbooks/ffmpeg.md)"$'\n'
for arch in amd64 arm64; do
    name="weir-ffmpeg-${FFMPEG_VERSION}-${BUILD_REVISION}-linux-${arch}"
    url="https://github.com/${repo}/releases/download/${tag}/${name}.tar.gz"
    echo "fetching $url" >&2
    curl -fsSL --retry 3 -o "$work/$name.tar.gz" "$url"
    sha=$(shasum -a 256 "$work/$name.tar.gz" | cut -d' ' -f1)
    block+="http_archive(
    name = \"ffmpeg_linux_${arch}\",
    build_file_content = 'exports_files([\"bin/ffmpeg\", \"bin/ffprobe\"])\nfilegroup(name = \"files\", srcs = glob([\"**\"]), visibility = [\"//visibility:public\"])',
    sha256 = \"${sha}\",
    strip_prefix = \"${name}\",
    url = \"${url}\",
)
"
done
block+="# END ffmpeg"

python3 -I - "$block" <<'PY'
import re, sys
path = "MODULE.bazel"
text = open(path).read()
new, n = re.subn(r"# BEGIN ffmpeg.*?# END ffmpeg", lambda _: sys.argv[1], text, flags=re.S)
if n != 1:
    sys.exit("MODULE.bazel has no '# BEGIN ffmpeg' ... '# END ffmpeg' block")
open(path, "w").write(new)
PY

cat >third_party/ffmpeg/BUILD.bazel <<'BUILD'
# Written by tools/ffmpeg/pin.sh. The pinned ffmpeg build for the host;
# Linux only for now, so other platforms skip these targets.

[
    filegroup(
        name = tool,
        srcs = select({
            "//tools/platforms:linux_amd64": ["@ffmpeg_linux_amd64//:bin/" + tool],
            "//tools/platforms:linux_arm64": ["@ffmpeg_linux_arm64//:bin/" + tool],
        }),
        target_compatible_with = ["@platforms//os:linux"],
        visibility = ["//visibility:public"],
    )
    for tool in [
        "ffmpeg",
        "ffprobe",
    ]
]
BUILD

echo "Pinned $tag. Review and commit MODULE.bazel and third_party/ffmpeg/BUILD.bazel." >&2
