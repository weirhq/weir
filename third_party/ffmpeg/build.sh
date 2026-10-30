#!/usr/bin/env bash
# Builds ffmpeg and ffprobe into a relocatable tarball. Runs inside the image
# from third_party/ffmpeg/Dockerfile:
#
#   docker build -t weir-ffmpeg-build third_party/ffmpeg
#   docker run --rm -v "$PWD:/src" -w /src weir-ffmpeg-build \
#       third_party/ffmpeg/build.sh out/
#
# ffmpeg's own libraries are linked statically. External libraries are
# bundled in lib/ (found through an $ORIGIN rpath), except those that must
# match the host's drivers or C library.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "${1:?usage: build.sh <out-dir>}" && cd "$1" && pwd)
# shellcheck source=source.env
source "$here/source.env"

arch=$(dpkg --print-architecture)
name="weir-ffmpeg-${FFMPEG_VERSION}-${BUILD_REVISION}-linux-${arch}"
work=$(mktemp -d)
prefix="$work/$name"
trap 'rm -rf "$work"' EXIT

fetch() { # url sha256 dest
    curl -fsSL --retry 5 --retry-all-errors -o "$3" "$1"
    echo "$2  $3" | sha256sum --check --quiet
}

echo "--- nv-codec-headers ${NV_CODEC_HEADERS_VERSION}"
fetch "https://github.com/FFmpeg/nv-codec-headers/archive/refs/tags/${NV_CODEC_HEADERS_VERSION}.tar.gz" \
    "$NV_CODEC_HEADERS_SHA256" "$work/nvch.tar.gz"
mkdir "$work/nvch" && tar -xzf "$work/nvch.tar.gz" -C "$work/nvch" --strip-components=1
make -C "$work/nvch" PREFIX="$work/deps" install >/dev/null
export PKG_CONFIG_PATH="$work/deps/lib/pkgconfig"

echo "--- Vulkan-Headers ${VULKAN_HEADERS_VERSION}"
fetch "https://github.com/KhronosGroup/Vulkan-Headers/archive/refs/tags/${VULKAN_HEADERS_VERSION}.tar.gz" \
    "$VULKAN_HEADERS_SHA256" "$work/vkh.tar.gz"
mkdir "$work/vkh" && tar -xzf "$work/vkh.tar.gz" -C "$work/vkh" --strip-components=1
cmake -S "$work/vkh" -B "$work/vkh/build" -G Ninja -DCMAKE_INSTALL_PREFIX="$work/deps" >/dev/null
cmake --install "$work/vkh/build" >/dev/null

echo "--- libplacebo ${LIBPLACEBO_VERSION}"
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$LIBPLACEBO_VERSION" \
    --recurse-submodules --shallow-submodules https://code.videolan.org/videolan/libplacebo.git "$work/placebo"
[ "$(git -C "$work/placebo" rev-parse HEAD)" = "$LIBPLACEBO_COMMIT" ] || {
    echo "libplacebo ${LIBPLACEBO_VERSION} is not commit ${LIBPLACEBO_COMMIT}" >&2
    exit 1
}
# Static, so it links into ffmpeg. vk-proc-addr off: ffmpeg loads Vulkan at
# runtime and hands libplacebo the loader, so hosts without one can still run.
meson setup "$work/placebo/build" "$work/placebo" --prefix="$work/deps" --libdir=lib \
    --buildtype=release --default-library=static -Dc_args="-I$work/deps/include" \
    -Dvulkan=enabled -Dvk-proc-addr=disabled -Dvulkan-registry="$work/deps/share/vulkan/registry/vk.xml" \
    -Dshaderc=enabled -Dglslang=disabled -Dlcms=enabled -Dopengl=disabled -Dd3d11=disabled \
    -Dlibdovi=disabled -Dxxhash=disabled -Dunwind=disabled \
    -Ddemos=false -Dtests=false -Dbench=false -Dfuzz=false >/dev/null
ninja -C "$work/placebo/build" install >/dev/null

echo "--- ffmpeg ${FFMPEG_VERSION}"
fetch "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" "$FFMPEG_SHA256" "$work/ffmpeg.tar.xz"
mkdir "$work/ffmpeg" && tar -xJf "$work/ffmpeg.tar.xz" -C "$work/ffmpeg" --strip-components=1
for patch in "$here"/patches/*.patch; do
    [ -e "$patch" ] || continue
    echo "applying $(basename "$patch")"
    patch -d "$work/ffmpeg" -p1 --forward <"$patch"
done

args=()
while read -r line; do
    line=${line%%#*}
    [ -n "${line// /}" ] && args+=("$line")
done <"$here/configure.args"
args+=(
    "--prefix=$prefix"
    "--extra-version=weir${BUILD_REVISION}"
    # The newer Vulkan headers, and libplacebo's private (static) deps.
    "--extra-cflags=-I$work/deps/include"
    "--pkg-config-flags=--static"
    # Static libplacebo has C++ parts its .pc doesn't declare.
    "--extra-libs=-lstdc++"
)
# oneVPL (Intel QSV) exists only on x86.
[ "$arch" = amd64 ] && args+=(--enable-libvpl)

cd "$work/ffmpeg"
./configure "${args[@]}" || { tail -50 ffbuild/config.log; exit 1; }
make -j"$(nproc)"
make install
rm -rf "${prefix:?}/include" "${prefix:?}/lib" "${prefix:?}/share"

echo "--- bundling shared libraries"
# Provided by the host: the C library, and everything that has to match the
# installed GPU drivers.
system='^(linux-vdso|ld-linux|libc|libm|libdl|librt|libpthread|libgcc_s|libstdc\+\+|libva|libva-drm|libdrm|libvulkan)\.so'
mkdir -p "$prefix/lib"
for bin in "$prefix"/bin/*; do
    ldd "$bin" | awk '$3 ~ /^\// {print $1, $3}' | while read -r soname path; do
        if [[ ! $soname =~ $system ]]; then
            cp -L --update=none "$path" "$prefix/lib/$soname"
        fi
    done
    patchelf --set-rpath '$ORIGIN/../lib' "$bin"
done
for lib in "$prefix"/lib/*; do
    patchelf --set-rpath '$ORIGIN' "$lib"
done

cp COPYING.GPLv3 "$prefix/LICENSE"
{
    echo "ffmpeg ${FFMPEG_VERSION} (weir build ${BUILD_REVISION}), linux/${arch}"
    echo "built on $(. /etc/os-release && echo "$PRETTY_NAME"), $(ldd --version | sed -n 1p)"
    echo
    echo "configure:"
    printf '  %s\n' "${args[@]}"
    echo
    echo "bundled libraries:"
    (cd "$prefix/lib" && ls -1 | sed 's/^/  /')
} >"$prefix/BUILDINFO"

# Fails the build if a bundled library is missing or the binary can't start.
# (No `head` or `grep -q`: they close the pipe early, and with pipefail the
# writer's SIGPIPE fails the build.)
LD_LIBRARY_PATH='' "$prefix/bin/ffmpeg" -hide_banner -version | sed -n 1p
LD_LIBRARY_PATH='' "$prefix/bin/ffmpeg" -hide_banner -filters | grep libplacebo >/dev/null

tar -C "$work" --owner=0 --group=0 --sort=name -czf "$out/$name.tar.gz" "$name"
(cd "$out" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
echo "--- $out/$name.tar.gz"
