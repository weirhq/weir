# Changelog: weir-engine

Engine releases are tagged `engine/vX.Y.Z` and ship the engine image. The
server says which engine versions it works with; see the server's
changelog. The release workflow publishes the section below whose heading
matches the tag.

## 0.1.0

The first release.

- **Contract.** `weir.engine.v1alpha` over gRPC on a Unix socket, which
  the server reaches as a member of the `weir` group (the socket is
  `0660`).
- **Probing.** Reports each file's container, streams, codecs, HDR format
  and tags to the server's scanner.
- **Playback sessions.** Remuxes or transcodes one file into fMP4 HLS
  segments in a folder the server gives it, signals when the first segment
  is ready, and seeks when a player jumps ahead.
- **Capabilities.** Reports its version, ffmpeg's, the session limit and
  the hardware it found.
- **Bundled ffmpeg.** 9.0.2, Weir build 1, with libx264 for transcoding.
  Hardware acceleration arrives in a later release.
- **Packaging.** `ghcr.io/weirhq/engine` for linux/amd64 and linux/arm64,
  on distroless Debian 13 with the VA-API libraries ffmpeg needs.
