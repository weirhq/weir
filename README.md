# Weir

A self-hosted media server where households share libraries with each other, and
watch together across servers, without a company in the middle.

Weir is pre-release. Phase 0 (foundations) is in progress.

## Layout

```
weir/
├── MODULE.bazel
├── proto/                 # Apache-2.0; the only cross-language contract
│   ├── weir/engine/       # server ↔ engine (gRPC)
│   ├── weir/api/          # server ↔ clients (Connect)
│   └── weir/federation/   # server ↔ server (Connect)
├── server/                # Go: cmd/weir-server, internal/{library,playback,federation,syncplay,auth,jobs}
├── engine/                # Rust workspace: weir-engine binary + crates/{probe,dovi,tonemap,remux,session}
├── web/                   # TypeScript, React, Vite; pnpm workspace
│   ├── app/               # the SPA
│   └── ui/                # M3E token + component layer on Radix
├── desktop/               # Tauri 2 app; embeds web/app build + libmpv
├── third_party/ffmpeg/    # build scripts + pinned source tarballs
├── deploy/                # Dockerfiles, compose, systemd units, Homebrew formula
├── tools/                 # Bazel macros, lint config, release scripts
└── docs/
```

## Development

Toolchains are pinned in `mise.toml`. Install [mise](https://mise.jdx.dev), then:

```sh
mise install
bazel build //...
```

`tools/bin/bazel` forwards to Bazelisk, which reads the Bazel version from
`.bazelversion`. mise puts it on `PATH` inside this repository.

Day-to-day work can use `go run`, `cargo run` and `pnpm dev` directly. Release
and CI builds are Bazel only.

| Task | What it does |
| --- | --- |
| `mise run db` | Starts Postgres for development on `127.0.0.1:55432` (user, password and database `weir`) |
| `mise run generate` | Writes protobuf and sqlc code into the tree for `go run` and editors; gitignored |
| `mise run gazelle` | Tidies `go.mod`, regenerates Go BUILD files, syncs `MODULE.bazel` |

Postgres-backed tests skip unless `WEIR_TEST_DATABASE_URL` is set. Each test
creates and drops its own database:

```sh
mise run db
export WEIR_TEST_DATABASE_URL=postgres://weir:weir@127.0.0.1:55432/weir
bazel test //...
```

To run the server outside Bazel, configure it through `weir.toml` or the
`WEIR_*` environment variables (see `server/internal/config`):

```sh
mise run generate
go run ./server/cmd/weir-server -config weir.toml
```

The server reaches the engine at `engine_socket`. Set `engine_command` to
have the server run and restart the engine itself; leave it empty when
something else runs it, as Docker Compose does. To run the engine on its own:

```sh
cd engine && cargo run -p weir-engine -- --socket /tmp/weir-engine.sock
```

Until the bundled ffmpeg build lands, the engine uses the `ffprobe` on `PATH`
(or `--ffprobe`).

The web client is a pnpm workspace in `web/`. With the server running on
:8320, `pnpm dev` serves the app on http://localhost:5173 and proxies API calls
to the server. Bazel builds embed the client in `weir-server`; `go run` builds
don't.

```sh
cd web && pnpm install && pnpm dev
```

## Rules we hold each other to

- Generated code is never committed. If a generator is too slow for Bazel's
  cache, fix the cache, don't commit output.
- `proto/` changes land in their own PR with the `buf breaking` output in the
  description.
- No crate, Go module, or npm package is added without a one-line reason in the
  PR.
- Dev loop outside Bazel is allowed; release and CI are Bazel only.

## License

Every first-party component (server, engine, web, desktop) is
[AGPL-3.0](LICENSE). The protobuf contract in `proto/` is
[Apache-2.0](proto/LICENSE) so third-party clients and alternative engines can
implement it without AGPL obligations.
