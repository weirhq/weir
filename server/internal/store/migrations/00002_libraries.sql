-- +goose Up

CREATE TABLE library (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('movies', 'shows', 'music')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE library_path (
    library_id uuid NOT NULL REFERENCES library (id) ON DELETE CASCADE,
    path text NOT NULL,
    PRIMARY KEY (library_id, path)
);

-- A thing people watch or listen to. Shows, seasons, artists and albums are
-- items too, so browsing is one table. Scans never create items directly:
-- the matcher attaches each media file to one, found by match_key.
CREATE TABLE item (
    id uuid PRIMARY KEY,
    library_id uuid NOT NULL REFERENCES library (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('movie', 'show', 'season', 'episode', 'artist', 'album', 'track')),
    -- season -> show, episode -> season, album -> artist, track -> album.
    parent_id uuid REFERENCES item (id) ON DELETE CASCADE,
    title text NOT NULL,
    sort_title text NOT NULL,
    year int,
    -- Season, episode or track number; disc number for tracks.
    index_number int,
    disc_number int,
    -- tmdb, tvdb, imdb, musicbrainz. Filled by metadata, not by scans.
    external_ids jsonb NOT NULL DEFAULT '{}',
    -- The matcher's identity for this item among its siblings, e.g.
    -- "blade runner|1982" or "s01".
    match_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX item_match_key ON item (library_id, kind, parent_id, match_key) NULLS NOT DISTINCT;
CREATE INDEX item_parent_id_idx ON item (parent_id);
CREATE INDEX item_library_kind_idx ON item (library_id, kind, sort_title);

-- One playable copy of an item: 'Theatrical 4K DV', 'Extended 1080p', a
-- FLAC rip. One file per version in v1.
CREATE TABLE version (
    id uuid PRIMARY KEY,
    item_id uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    edition text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX version_item_id_idx ON version (item_id);

-- A file a scan found. version_id is null while the matcher can't place it.
CREATE TABLE media_file (
    id uuid PRIMARY KEY,
    library_id uuid NOT NULL REFERENCES library (id) ON DELETE CASCADE,
    version_id uuid UNIQUE REFERENCES version (id) ON DELETE SET NULL,
    path text NOT NULL UNIQUE,
    size_bytes bigint NOT NULL,
    modified_at timestamptz NOT NULL,
    container text NOT NULL,
    duration_ms bigint,
    probe_hash text NOT NULL,
    -- The engine's ProbeResponse as protojson, for playback decisions.
    probe jsonb NOT NULL,
    scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_file_library_id_idx ON media_file (library_id);

CREATE TABLE stream (
    media_file_id uuid NOT NULL REFERENCES media_file (id) ON DELETE CASCADE,
    index int NOT NULL,
    kind text NOT NULL CHECK (kind IN ('video', 'audio', 'subtitle', 'data')),
    codec text NOT NULL,
    profile text NOT NULL,
    language text NOT NULL,
    title text NOT NULL,
    is_default boolean NOT NULL,
    is_forced boolean NOT NULL,
    -- sdr, hdr10, hdr10plus, hlg or dv; null for non-video streams.
    hdr_format text,
    width int,
    height int,
    channels int,
    PRIMARY KEY (media_file_id, index)
);

-- +goose Down

DROP TABLE stream;
DROP TABLE media_file;
DROP TABLE version;
DROP TABLE item;
DROP TABLE library_path;
DROP TABLE library;
