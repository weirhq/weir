-- +goose Up

-- What a member may do in a library. Admins can do everything and have no
-- rows here. No row means no access.
CREATE TABLE library_access (
    user_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    library_id uuid NOT NULL REFERENCES library (id) ON DELETE CASCADE,
    can_view boolean NOT NULL,
    can_play boolean NOT NULL,
    can_manage boolean NOT NULL,
    PRIMARY KEY (user_id, library_id)
);

-- Search: trigrams forgive typos in titles; full text covers overviews and
-- cast. pg_trgm is a trusted extension, so the database owner may add it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX item_title_trgm_idx ON item USING gin (title gin_trgm_ops);
CREATE INDEX metadata_search_idx ON metadata USING gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(original_title, '') || ' '
        || coalesce(overview, '') || ' ' || cast_members::text)
);

-- +goose Down

DROP INDEX metadata_search_idx;
DROP INDEX item_title_trgm_idx;
DROP TABLE library_access;
