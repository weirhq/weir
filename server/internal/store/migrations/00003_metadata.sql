-- +goose Up

-- What one source says about one item. Each source writes only its own
-- rows; resolved_metadata picks per field.
CREATE TABLE metadata (
    item_id uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('nfo', 'tmdb', 'tvdb', 'musicbrainz')),
    title text,
    original_title text,
    overview text,
    tagline text,
    year int,
    release_date date,
    runtime_minutes int,
    -- 0 to 10.
    rating real,
    -- e.g. "PG-13".
    content_rating text,
    genres text[] NOT NULL DEFAULT '{}',
    -- [{"name": ..., "role": ...}] in billing order.
    cast_members jsonb NOT NULL DEFAULT '[]',
    -- {"tmdb": "603", "imdb": "tt0133093", "musicbrainz": "..."}
    external_ids jsonb NOT NULL DEFAULT '{}',
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, source)
);

-- When a lookup last ran for an item, found or not, so items no source knows
-- aren't retried on every scan.
CREATE TABLE metadata_attempt (
    item_id uuid PRIMARY KEY REFERENCES item (id) ON DELETE CASCADE,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Where an item's pictures can be had. Files are fetched, resized and cached
-- under data/artwork/ when first shown, which fills hash and dimensions.
CREATE TABLE artwork (
    item_id uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('poster', 'backdrop', 'logo', 'thumb')),
    source text NOT NULL CHECK (source IN ('local', 'tmdb', 'tvdb', 'coverartarchive')),
    -- An absolute file path for local artwork, otherwise a URL.
    location text NOT NULL,
    hash text,
    width int,
    height int,
    PRIMARY KEY (item_id, kind, source)
);

-- Source priority, best first. Per-library policy is future work.
CREATE FUNCTION metadata_priority(source text) RETURNS int
LANGUAGE sql IMMUTABLE
RETURN array_position(ARRAY['nfo', 'tmdb', 'tvdb', 'musicbrainz'], source);

CREATE FUNCTION artwork_priority(source text) RETURNS int
LANGUAGE sql IMMUTABLE
RETURN array_position(ARRAY['local', 'tmdb', 'tvdb', 'coverartarchive'], source);

-- Each field from the best source that has it, falling back to what the scan
-- found in file names. Unknown is '' or 0, so every column is non-null.
CREATE VIEW resolved_metadata AS
SELECT
    i.id AS item_id,
    COALESCE((array_agg(m.title ORDER BY metadata_priority(m.source)) FILTER (WHERE m.title IS NOT NULL))[1], i.title)::text AS title,
    COALESCE((array_agg(m.original_title ORDER BY metadata_priority(m.source)) FILTER (WHERE m.original_title IS NOT NULL))[1], '')::text AS original_title,
    COALESCE((array_agg(m.overview ORDER BY metadata_priority(m.source)) FILTER (WHERE m.overview IS NOT NULL))[1], '')::text AS overview,
    COALESCE((array_agg(m.tagline ORDER BY metadata_priority(m.source)) FILTER (WHERE m.tagline IS NOT NULL))[1], '')::text AS tagline,
    COALESCE((array_agg(m.year ORDER BY metadata_priority(m.source)) FILTER (WHERE m.year IS NOT NULL))[1], i.year, 0)::int AS year,
    -- YYYY-MM-DD.
    COALESCE(to_char((array_agg(m.release_date ORDER BY metadata_priority(m.source)) FILTER (WHERE m.release_date IS NOT NULL))[1], 'YYYY-MM-DD'), '')::text AS release_date,
    COALESCE((array_agg(m.runtime_minutes ORDER BY metadata_priority(m.source)) FILTER (WHERE m.runtime_minutes IS NOT NULL))[1], 0)::int AS runtime_minutes,
    COALESCE((array_agg(m.rating ORDER BY metadata_priority(m.source)) FILTER (WHERE m.rating IS NOT NULL))[1], 0)::real AS rating,
    COALESCE((array_agg(m.content_rating ORDER BY metadata_priority(m.source)) FILTER (WHERE m.content_rating IS NOT NULL))[1], '')::text AS content_rating,
    -- A subquery, not array_agg: aggregating arrays makes a 2-D array.
    COALESCE((
        SELECT m2.genres FROM metadata m2
        WHERE m2.item_id = i.id AND cardinality(m2.genres) > 0
        ORDER BY metadata_priority(m2.source) LIMIT 1
    ), '{}')::text[] AS genres,
    COALESCE((array_agg(m.cast_members ORDER BY metadata_priority(m.source)) FILTER (WHERE m.cast_members <> '[]'))[1], '[]')::jsonb AS cast_members,
    -- Ids from every source together. Aggregated worst source first, so on a
    -- clash the better source's value is the one kept.
    (i.external_ids || COALESCE((
        SELECT jsonb_object_agg(e.key, e.value ORDER BY metadata_priority(m2.source) DESC)
        FROM metadata m2, jsonb_each(m2.external_ids) e
        WHERE m2.item_id = i.id
    ), '{}'))::jsonb AS external_ids
FROM item i
LEFT JOIN metadata m ON m.item_id = i.id
GROUP BY i.id;

-- +goose Down

DROP VIEW resolved_metadata;
DROP FUNCTION artwork_priority;
DROP FUNCTION metadata_priority;
DROP TABLE artwork;
DROP TABLE metadata_attempt;
DROP TABLE metadata;
