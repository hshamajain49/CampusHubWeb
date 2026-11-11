-- migrate:up
-- CampusHub Venue Booking — required extensions.
-- btree_gist: allows "venue_id WITH =" (uuid) inside GiST exclusion constraints.
-- Available on Neon and in the official postgres:17 image. gen_random_uuid() is built in (PostgreSQL 13+).
create extension if not exists btree_gist;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
