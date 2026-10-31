# Changelog: weir-server

Server releases are tagged `server/vX.Y.Z`. Each one ships the server
image, the all-in-one image, the tarballs and the Compose files; the
all-in-one image and the tarballs carry the engine from the same commit.
The release workflow publishes the section below whose heading matches the
tag.

## 0.1.0

The first release: films, shows and music in a web app, for you and the
people you share with.

- **Setup.** The first visit creates the admin account. Configuration is
  one `weir.toml`, or environment variables, checked on start with every
  problem listed at once. The database migrates on start;
  `--check-migrations` lists what would run without running it.
- **Libraries.** Films, shows and music from folders under the server's
  allowed library paths, scanned in the background when added and again
  whenever an admin asks.
- **Metadata.** From NFO files and local artwork, then TMDB for films and
  shows (with an API key) and MusicBrainz for music.
- **Browsing.** Libraries, search, Continue Watching and Recently Added,
  with resized artwork.
- **Playback.** Each play is direct play, remux or transcode, decided
  from what the browser says it can play, and the player says why.
  Remuxes and transcodes stream as HLS from `weir-engine`. Progress and
  watched state are kept per user.
- **Music.** A mini-player with a queue that keeps playing while you
  browse, and playlists.
- **Users.** Admins add users and choose which libraries each can see.
  Admin changes ask for your password again after ten minutes.
- **Status.** Settings shows the engine's health, its version and
  ffmpeg's, and recent background jobs.
- **Engine compatibility.** Works with `weir-engine` 0.1.x, and says so
  plainly when the engine is outside that range.
- **Packaging.** `ghcr.io/weirhq/server` and the all-in-one
  `ghcr.io/weirhq/weir` for linux/amd64 and linux/arm64, a Compose file,
  and a tarball with systemd units. See `docs/install.md`.

Hardware-accelerated transcoding isn't in this release; the engine encodes
in software.
