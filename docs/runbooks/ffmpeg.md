# Runbook: the ffmpeg build

Weir's engine ships its own ffmpeg. Luna owns the build and its patch set, but
anyone can rebuild it and pin the result without knowing either. This page is
everything that takes.

## How it fits together

| Piece | What it is |
| --- | --- |
| `third_party/ffmpeg/source.env` | The inputs: ffmpeg version and sha256, nv-codec-headers version and sha256, and `BUILD_REVISION` |
| `third_party/ffmpeg/configure.args` | The configure flags, one per line |
| `third_party/ffmpeg/patches/*.patch` | Weir's patches, applied in name order (none yet) |
| `third_party/ffmpeg/Dockerfile` | The build environment: Ubuntu 24.04, pinned by digest, which sets the tarball's glibc floor at 2.39 |
| `third_party/ffmpeg/build.sh` | Builds one architecture into `weir-ffmpeg-<version>-<revision>-linux-<arch>.tar.gz` |
| `.github/workflows/ffmpeg.yml` | Builds amd64 and arm64, then publishes a GitHub release tagged `ffmpeg-<version>-<revision>` |
| `tools/ffmpeg/pin.sh` | Hashes a published release and pins it in `MODULE.bazel` |

A release is published only if its tag doesn't exist yet. The workflow never
replaces assets, because a pinned sha256 would stop matching.

`ffmpeg-9.0.2-1` is pinned. Bazel and `pin.sh` download release assets
without credentials, so pinning only works while `weirhq/weir` is public.

## Rebuild and pin

1. Change the inputs. Either:
   - **New ffmpeg version:** see "Bumping ffmpeg" below, then set
     `BUILD_REVISION=1`.
   - **Same version, different build** (flags, patches, Dockerfile, headers):
     increase `BUILD_REVISION` by one.
2. Merge the change to `main`. The workflow runs on any change under
   `third_party/ffmpeg/`. To run it by hand: Actions → ffmpeg → Run workflow, or
   `gh workflow run ffmpeg.yml`.
3. Wait for the new release to appear under Releases (about 15 minutes).
4. Pin it:

   ```sh
   tools/ffmpeg/pin.sh
   bazel build @ffmpeg_linux_amd64//:files @ffmpeg_linux_arm64//:files
   ```

5. Commit `MODULE.bazel` and `third_party/ffmpeg/BUILD.bazel` as
   `build(ffmpeg): pin ffmpeg-<version>-<revision>`.

## Bumping ffmpeg

Verify the new release's signature before trusting its hash:

```sh
v=9.0.3   # the new version
curl -fsSLO https://ffmpeg.org/releases/ffmpeg-$v.tar.xz
curl -fsSLO https://ffmpeg.org/releases/ffmpeg-$v.tar.xz.asc
curl -fsSL https://ffmpeg.org/ffmpeg-devel.asc | gpg --import
gpg --verify ffmpeg-$v.tar.xz.asc ffmpeg-$v.tar.xz
shasum -a 256 ffmpeg-$v.tar.xz
```

The signature must say "Good signature" from key
`FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8`. Put the version and
sha256 in `source.env`. If a patch no longer applies, the build fails at
"applying …"; that one is for Luna.

## Building locally

```sh
docker build -t weir-ffmpeg-build third_party/ffmpeg
docker run --rm -v "$PWD:/src" -w /src weir-ffmpeg-build third_party/ffmpeg/build.sh out
```

This builds for your Docker host's architecture. On Apple Silicon that is
linux/arm64, in about 10 minutes.

## When it fails

| Symptom | Cause and fix |
| --- | --- |
| `sha256sum: WARNING: 1 computed checksum did NOT match` | `source.env` doesn't match the download. Recheck the version and hash. |
| configure fails | The last 50 lines of `config.log` are printed. Usually an Ubuntu package is missing from the Dockerfile. |
| The final `-filters` check fails | libplacebo didn't link; check the configure output for vulkan. |
| "already published; leaving it alone" | That tag exists. Increase `BUILD_REVISION` to publish a new build. |
| `pin.sh` 404s | The release isn't published yet, or `WEIR_REPO` is wrong. |

## Not covered yet

macOS and Windows builds come later; the Phase 1 and 2 gates need only Linux.
The CUDA and Intel engine images will add driver userspace on top of this
tarball. The tarball itself needs libva and libdrm from the host, because they
must match the installed GPU drivers. The Vulkan loader (`libvulkan1`) is
optional: ffmpeg loads it at runtime, and only GPU tonemapping needs it.
