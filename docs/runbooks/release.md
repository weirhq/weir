# Runbook: releasing the server and engine

The server and engine are released separately, each from its own tag:
`server/vX.Y.Z` and `engine/vX.Y.Z`. `.github/workflows/release.yml` does
the rest.

## What a release publishes

| Tag | Images | Release files |
| --- | --- | --- |
| `engine/vX.Y.Z` | `ghcr.io/weirhq/engine:X.Y.Z` | none; the notes only |
| `server/vX.Y.Z` | `ghcr.io/weirhq/server:X.Y.Z`, `ghcr.io/weirhq/weir:X.Y.Z` | `weir-X.Y.Z-linux-{amd64,arm64}.tar.gz`, `docker-compose.yml`, `weir.env.example`, `SHA256SUMS` |

Each image is a two-architecture index joined from `X.Y.Z-amd64` and
`X.Y.Z-arm64`, which stay pushed. The all-in-one image and the tarballs
carry the engine from the tagged commit. The Compose file names the
engine version in that commit's source, so that engine must already be
released.

## How the workflow runs

1. **check** reads the versions from the source and refuses the tag if it
   doesn't match them (`tools/release/check.sh`), or if the component's
   `CHANGELOG.md` has no `## X.Y.Z` section, which becomes the release
   notes. For a server tag it also refuses an engine version that can't
   be pulled.
2. **verify**, on amd64 and arm64, builds the images and tarball, checks
   the tarball's engine and ffmpeg run, makes two test films with that
   ffmpeg, loads the images and runs `tools/release/smoke.sh` against both
   the Compose file and the all-in-one image.
3. **push**, only for tags and only once both architectures pass, pushes
   `X.Y.Z-<arch>`.
4. **publish** joins the architectures under `X.Y.Z`, drafts the GitHub
   release, checks every image can be pulled without signing in, then
   publishes it. Server releases are marked Latest; engine releases and
   pre-releases (`X.Y.Z-rc.N`) aren't.

Pushes to `main` that change `deploy/`, `tools/release/`, `MODULE.bazel` or
the workflow run steps 1 and 2 only, as does Actions → release → Run
workflow (`gh workflow run release.yml`).

## Releasing

1. Bump the version if needed: for the server, `Server` in
   `server/internal/version/version.go` and `SERVER_VERSION` in
   `version.bzl`; for the engine, `engine/Cargo.toml` and
   `engine/version.bzl`. `version_test` checks they agree. A minor engine
   release before 1.0 also needs the server's `MaxEngine` raised.
2. Add a `## X.Y.Z` section to the changelog and push both to `main`.
3. If the server release needs a new engine, tag the engine first and
   wait for it to publish:

   ```sh
   git tag -a engine/vX.Y.Z -m "weir-engine X.Y.Z" && git push origin engine/vX.Y.Z
   ```

4. Tag the server the same way, as `server/vX.Y.Z`.

### A new image is private

A new ghcr package can start out private, and the REST API can't change
that. If one does, the release stops at a draft with an error naming it. Open
the package's settings (the error links them), choose Change visibility,
make it public, then re-run the publish job. Each package needs this once.

### Running the smoke test yourself

On Linux with Docker:

```sh
tools/bin/bazel run //deploy:server_load && tools/bin/bazel run //deploy:engine_load && tools/bin/bazel run //deploy:weir_load
m=$(mktemp -d) && tools/release/make-media.sh ffmpeg "$m"   # needs libx264 and libx265
tools/release/smoke.sh compose "$m"
tools/release/smoke.sh all-in-one "$m"
```
