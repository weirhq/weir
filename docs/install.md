# Installing Weir

Weir is three processes: `weir-server`, `weir-engine` and PostgreSQL 15 or
later. Pick one way to run them. All three need Linux on amd64 or arm64 for
now.

| Way | Gets you | Choose it when |
| --- | --- | --- |
| Docker Compose | Three containers, the engine sandboxed from the server | You run Docker and want upgrades to be `docker compose pull` |
| All-in-one image | One container; you bring PostgreSQL | You already run PostgreSQL somewhere |
| Tarball and systemd | Both binaries and ffmpeg in `/opt/weir` | You don't run Docker |

Whichever you pick, open the base URL afterwards. The first visit asks you
to create the admin account; then add libraries in Settings.

## Docker Compose

Take `docker-compose.yml` and `weir.env.example` from the release, then:

```sh
mkdir weir && cd weir
mv ~/Downloads/docker-compose.yml compose.yaml
mv ~/Downloads/weir.env.example .env
$EDITOR .env          # WEIR_MEDIA, WEIR_BASE_URL, WEIR_DB_PASSWORD
docker compose up -d
```

Your media folder is mounted read-only at `/media`; libraries use folders
inside it. To upgrade, change the versions in `.env` (or take the new
release's compose file) and run `docker compose pull && docker compose up -d`.
The server migrates its database on start.

## All-in-one image

`ghcr.io/weirhq/weir` holds the server and engine, and the server runs the
engine itself. Give it a database and your media:

```sh
docker run -d --name weir -p 8320:8320 \
  -e WEIR_DATABASE_URL=postgres://weir:PASSWORD@db.example.org:5432/weir \
  -e WEIR_LIBRARY_PATHS=/media \
  -e WEIR_BASE_URL=http://localhost:8320 \
  -e WEIR_TLS_MODE=off \
  -v weir-data:/var/lib/weir \
  -v /srv/media:/media:ro \
  --tmpfs /var/cache/weir/segments:size=4g,uid=10001,gid=10000,mode=0770 \
  ghcr.io/weirhq/weir:0.1.0
```

## Tarball and systemd

The tarball needs glibc 2.39 or later: Ubuntu 24.04, Debian 13, Fedora 40
and their successors. It also needs `libva2`, `libva-drm2` and `libdrm2`
from your distribution, so that ffmpeg matches your GPU drivers.

```sh
sudo tar -C /opt -xzf weir-0.1.0-linux-amd64.tar.gz
sudo ln -sfn /opt/weir-0.1.0 /opt/weir

sudo cp /opt/weir/systemd/weir.conf /etc/sysusers.d/
sudo systemd-sysusers
sudo cp /opt/weir/systemd/*.service /etc/systemd/system/

sudo mkdir -p /etc/weir
sudo cp /opt/weir/weir.toml.example /etc/weir/weir.toml
sudoedit /etc/weir/weir.toml   # database_url, library_paths, base_url
sudo chown weir-server /etc/weir/weir.toml && sudo chmod 600 /etc/weir/weir.toml

sudo systemctl daemon-reload
sudo systemctl enable --now weir-engine weir-server
```

Create the database first if you haven't:

```sh
sudo -u postgres createuser -P weir
sudo -u postgres createdb -O weir weir
```

The units run the server as `weir-server` and the engine as `weir-engine`,
both in the `weir` group. Your media must be readable by them; the engine
can't write anywhere but `/var/cache/weir/segments`, and only the server can
read `weir.toml`, which holds the database password. To upgrade, unpack the
new release, point `/opt/weir` at it and restart both units.

## Checking it worked

Settings, then Status, shows whether the server can reach the engine, its
version and ffmpeg's. "Not compatible" means the server and engine come
from releases that don't work together; install the pair from one release.
`journalctl -u weir-server -u weir-engine` or `docker compose logs` has the
rest.
