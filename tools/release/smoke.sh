#!/usr/bin/env bash
# Runs the locally loaded :dev images (bazel run //deploy:<name>_load) the
# way docs/install.md does, and checks setup, the engine, a scan, search,
# direct play, and a transcode that makes the engine run its bundled ffmpeg.
#
#   smoke.sh compose <media folder>      # deploy/compose: server and engine
#   smoke.sh all-in-one <media folder>   # ghcr.io/weirhq/weir and a Postgres
#
# make-media.sh writes a media folder with the two films this expects. Needs
# docker, curl, jq and openssl.
set -euo pipefail

mode=$1 media=$2
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
port=8330 name=weir-smoke base=http://localhost:8330
password=$(openssl rand -hex 16)
tmp=$(mktemp -d)

case $mode in
compose)
    export WEIR_VERSION=dev WEIR_ENGINE_VERSION=dev WEIR_MEDIA=$media WEIR_PORT=$port \
        WEIR_BASE_URL=$base WEIR_DB_PASSWORD=$password
    dc() { docker compose -p "$name" -f "$repo/deploy/compose/compose.yaml" "$@"; }
    up() { dc up -d --wait --wait-timeout 120; }
    logs() { dc logs --tail 60; }
    down() { dc down -v; }
    ;;
all-in-one)
    postgres=$(sed -n 's/^ *image: \(postgres:.*\)$/\1/p' "$repo/deploy/compose/compose.yaml")
    up() {
        docker network create "$name"
        docker run -d --name "$name-db" --network "$name" \
            -e POSTGRES_USER=weir -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=weir "$postgres"
        wait_for 60 Postgres docker exec "$name-db" pg_isready -q -U weir
        docker run -d --name "$name" --network "$name" -p "$port:8320" \
            -e WEIR_DATABASE_URL="postgres://weir:$password@$name-db:5432/weir" \
            -e WEIR_LIBRARY_PATHS=/media \
            -e WEIR_BASE_URL="$base" \
            -e WEIR_TLS_MODE=off \
            -v "$media:/media:ro" \
            --tmpfs /var/cache/weir/segments:size=1g,uid=10001,gid=10000,mode=0770 \
            ghcr.io/weirhq/weir:dev
    }
    logs() { docker logs --tail 60 "$name"; }
    down() {
        docker rm -f "$name" "$name-db"
        docker network rm "$name"
    }
    ;;
*)
    echo "usage: smoke.sh compose|all-in-one <media folder>" >&2
    exit 2
    ;;
esac

# wait_for <seconds> <what> <command...> retries the command once a second.
wait_for() {
    local n=$1 what=$2
    shift 2
    for _ in $(seq "$n"); do
        "$@" && return
        sleep 1
    done
    echo "smoke: gave up waiting for $what" >&2
    return 1
}

cleanup() {
    local status=$?
    [ "$status" -eq 0 ] || logs || true
    down >/dev/null 2>&1 || true
    rm -rf "$tmp"
    exit "$status"
}
trap cleanup EXIT

up
wait_for 60 /healthz curl -sf -o /dev/null "$base/healthz"
curl -sf "$base/" -o "$tmp/index.html"
grep -qi '<!doctype html' "$tmp/index.html" || { echo "smoke: / doesn't serve the web app" >&2; exit 1; }

api() {
    curl -sS --fail-with-body -H 'Content-Type: application/json' \
        ${TOKEN:+-H "Authorization: Bearer $TOKEN"} -d "$2" "$base/weir.api.v1alpha.$1"
}
TOKEN=$(api Auth/Bootstrap '{"username":"smoke","password":"smoke test password","displayName":"Smoke"}' |
    jq -er .credentials.accessToken)

engine_healthy() { api Admin/GetServerStatus '{}' | jq -e .engine.healthy >/dev/null; }
wait_for 60 'a healthy engine' engine_healthy
api Admin/GetServerStatus '{}' | jq -r '"engine \(.engine.engineVersion), \(.engine.ffmpegVersion)"'

lib=$(api Admin/CreateLibrary '{"name":"Films","kind":"LIBRARY_KIND_MOVIES","paths":["/media/films"]}' |
    jq -er .library.id)
scanned() { api Browse/ListItems "{\"libraryId\":\"$lib\"}" | jq -e '.total >= 2' >/dev/null; }
wait_for 60 'the scan' scanned

caps='{"videoCodecs":[{"codec":"h264"}],"audioCodecs":[{"codec":"aac","maxChannels":2}],"containers":["mp4"],"plainUrl":true,"hls":true}'
fetch() { curl -sf "$base$1" -o "$2"; }

# play <title> <expected method>
play() {
    local id plan method url dir
    id=$(api Browse/Search "{\"query\":\"$1\"}" | jq -er '.items[0].id')
    plan=$(api Playback/Start "{\"itemId\":\"$id\",\"capabilities\":$caps}")
    method=$(jq -r .plan.method <<<"$plan")
    url=$(jq -r '.plan.url // empty' <<<"$plan")
    if [ "$method" != "$2" ] || [ -z "$url" ]; then
        echo "smoke: $1 should play by $2 from a URL; the server planned:" >&2
        jq . <<<"$plan" >&2
        return 1
    fi
    if [ "$method" = PLAYBACK_METHOD_DIRECT_PLAY ]; then
        curl -sf -r 0-99 "$base$url" -o "$tmp/head"
        [ "$(wc -c <"$tmp/head")" -eq 100 ]
    else
        # A transcode's playlist lists every segment up front; each waits
        # for the engine, up to 20 s, then answers 504.
        dir=${url%%\?*}
        dir=${dir%/*}
        fetch "$url" "$tmp/index.m3u8"
        wait_for 60 'the init segment' fetch "$dir/init.mp4?${url#*\?}" "$tmp/init.mp4"
        wait_for 60 'the first segment' fetch "$dir/$(grep -m1 '\.m4s' "$tmp/index.m3u8")" "$tmp/0.m4s"
        grep -qa ftyp "$tmp/init.mp4"
        grep -qa moof "$tmp/0.m4s"
    fi
    echo "$1: $method ok"
}
play Arrival PLAYBACK_METHOD_DIRECT_PLAY
play Zodiac PLAYBACK_METHOD_VIDEO_TRANSCODE
