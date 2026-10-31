#!/usr/bin/env bash
# Gathers a server release's files into <out>, named as docs/install.md
# expects: the tarballs, docker-compose.yml and weir.env.example with their
# image versions set to this release's pair, and SHA256SUMS.
#
#   assets.sh <server version> <engine version> <tarball folder> <out>
set -euo pipefail

version=$1 engine=$2 tarballs=$3 out=$4
compose=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/deploy/compose
mkdir -p "$out"

for arch in amd64 arm64; do
    cp "$tarballs/weir-$version-linux-$arch.tar.gz" "$out/"
done

sed -e "s/\${WEIR_VERSION:-[^}]*}/\${WEIR_VERSION:-$version}/" \
    -e "s/\${WEIR_ENGINE_VERSION:-[^}]*}/\${WEIR_ENGINE_VERSION:-$engine}/" \
    "$compose/compose.yaml" >"$out/docker-compose.yml"
sed -e "s/^# WEIR_VERSION=.*/# WEIR_VERSION=$version/" \
    -e "s/^# WEIR_ENGINE_VERSION=.*/# WEIR_ENGINE_VERSION=$engine/" \
    "$compose/.env.example" >"$out/weir.env.example"

# Fail loudly if the files stopped looking the way the edits above expect.
grep -qF "ghcr.io/weirhq/server:\${WEIR_VERSION:-$version}" "$out/docker-compose.yml"
grep -qF "ghcr.io/weirhq/engine:\${WEIR_ENGINE_VERSION:-$engine}" "$out/docker-compose.yml"
grep -qx "# WEIR_VERSION=$version" "$out/weir.env.example"
grep -qx "# WEIR_ENGINE_VERSION=$engine" "$out/weir.env.example"

(cd "$out" && sha256sum -- *.tar.gz docker-compose.yml weir.env.example >SHA256SUMS)
