-- pg_trgm's trigram indexes let a search for text anywhere in a column (LIKE '%text%') use an index,
-- which a b-tree can't for a pattern that starts with a wildcard. The indexes themselves are in the
-- Drizzle schema (server/src/db/schema.ts). pg_trgm is a trusted extension, so kiln_migrator, which
-- owns the database, can create it without being a superuser
CREATE EXTENSION IF NOT EXISTS pg_trgm;
