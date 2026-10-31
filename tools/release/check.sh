#!/usr/bin/env bash
# Reads the server and engine versions from the source, checks each agrees
# across the files that hold it, and prints them for the release workflow:
#   server_version=X.Y.Z
#   engine_version=X.Y.Z
#
# Given a tag (server/vX.Y.Z or engine/vX.Y.Z), it also refuses one that
# doesn't match the source or has no section in that component's
# CHANGELOG.md, writes that section to <notes file>, and prints
#   component=server|engine
#   version=X.Y.Z
#   prerelease=true|false
#
#   check.sh [<tag> <notes file>]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail() {
    echo "check.sh: $*" >&2
    exit 1
}

# read <file> <sed expression printing the version>
read_version() {
    local v
    v=$(sed -n "$2" "$1")
    [ -n "$v" ] || fail "no version found in $1"
    echo "$v"
}

server=$(read_version server/internal/version/version.go 's/^const Server = "\(.*\)"$/\1/p')
server_bzl=$(read_version server/internal/version/version.bzl 's/^SERVER_VERSION = "\(.*\)"$/\1/p')
# The version under [workspace.package]; the crates inherit it.
engine=$(read_version engine/Cargo.toml '/^\[workspace\.package\]/,/^\[/s/^version = "\(.*\)"$/\1/p')
engine_bzl=$(read_version engine/version.bzl 's/^ENGINE_VERSION = "\(.*\)"$/\1/p')

[ "$server" = "$server_bzl" ] || fail "version.go says $server but version.bzl says $server_bzl"
[ "$engine" = "$engine_bzl" ] || fail "Cargo.toml says $engine but engine/version.bzl says $engine_bzl"
echo "server_version=$server"
echo "engine_version=$engine"

[ $# -eq 0 ] && exit 0
[ $# -eq 2 ] || fail "usage: check.sh [<tag> <notes file>]"
tag=$1 notes=$2

[[ $tag =~ ^(server|engine)/v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?)$ ]] ||
    fail "$tag isn't server/vX.Y.Z or engine/vX.Y.Z"
component=${BASH_REMATCH[1]} version=${BASH_REMATCH[2]}
if [ "$component" = server ]; then want=$server; else want=$engine; fi
[ "$version" = "$want" ] || fail "$tag doesn't match the source, which is $component $want"

# The lines after "## <version>" up to the next "## ", without the blank
# lines around them.
awk -v v="$version" '
    /^## / { if (found) exit; found = ($2 == v); next }
    !found { next }
    /^[[:space:]]*$/ { if (started) blanks++; next }
    { for (; blanks > 0; blanks--) print ""; print; started = 1 }
' "$component/CHANGELOG.md" >"$notes"
[ -s "$notes" ] || fail "$component/CHANGELOG.md has no \"## $version\" section"

echo "component=$component"
echo "version=$version"
if [[ $version == *-* ]]; then echo "prerelease=true"; else echo "prerelease=false"; fi
