-- +goose Up

-- Cover art embedded in a media file, such as an album's tracks. Its
-- location is the file's path and the picture's stream index, as
-- "path#index". It ranks below a picture in the folder, which someone chose
-- for the folder, and above anything fetched online.
ALTER TABLE artwork DROP CONSTRAINT artwork_source_check;
ALTER TABLE artwork ADD CONSTRAINT artwork_source_check
    CHECK (source IN ('local', 'embedded', 'tmdb', 'tvdb', 'coverartarchive'));

CREATE OR REPLACE FUNCTION artwork_priority(source text) RETURNS int
LANGUAGE sql IMMUTABLE
RETURN array_position(ARRAY['local', 'embedded', 'tmdb', 'tvdb', 'coverartarchive'], source);

-- +goose Down

DELETE FROM artwork WHERE source = 'embedded';

CREATE OR REPLACE FUNCTION artwork_priority(source text) RETURNS int
LANGUAGE sql IMMUTABLE
RETURN array_position(ARRAY['local', 'tmdb', 'tvdb', 'coverartarchive'], source);

ALTER TABLE artwork DROP CONSTRAINT artwork_source_check;
ALTER TABLE artwork ADD CONSTRAINT artwork_source_check
    CHECK (source IN ('local', 'tmdb', 'tvdb', 'coverartarchive'));
