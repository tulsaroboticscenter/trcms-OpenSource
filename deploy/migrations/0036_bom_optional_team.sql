-- Allow a BOM to be a general TRC BOM not tied to a specific team. Making
-- team_season_id nullable lets the column hold NULL (= "TRC — General"); the
-- existing foreign key still applies to non-null values.
ALTER TABLE inv_boms MODIFY COLUMN team_season_id INT NULL;
