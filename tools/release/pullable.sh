#!/usr/bin/env bash
# Succeeds if ghcr.io/weirhq/<image>:<tag> can be pulled without signing in,
# which is how docs/install.md has people pull it.
#
#   pullable.sh <image> <tag>
set -euo pipefail

image=$1 tag=$2
token=$(curl -sf "https://ghcr.io/token?scope=repository:weirhq/$image:pull" | jq -er .token)
curl -sfI -o /dev/null -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json' \
    "https://ghcr.io/v2/weirhq/$image/manifests/$tag"
