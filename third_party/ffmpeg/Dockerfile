# Build environment for Weir's Linux ffmpeg. Ubuntu 24.04 sets the glibc
# floor for the tarball at 2.39. Pinned by digest so a rebuild sees the same
# packages until someone bumps it.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl nasm patchelf pkg-config xz-utils \
        cmake git meson ninja-build python3 \
        libbz2-dev liblzma-dev zlib1g-dev \
        libdav1d-dev libnuma-dev libopus-dev libsvtav1enc-dev libx264-dev libx265-dev \
        libass-dev libfreetype-dev libharfbuzz-dev \
        liblcms2-dev libshaderc-dev libvulkan-dev \
        libdrm-dev libva-dev \
    && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
        apt-get install -y --no-install-recommends libvpl-dev; \
    fi \
    && rm -rf /var/lib/apt/lists/*
