ALTER TABLE "universes" ADD COLUMN "slug" text;--> statement-breakpoint
-- universeSlug() (shared/src/universes.ts) for the universes there are: lowercase, with every run of characters other than letters and digits turned into one hyphen
UPDATE "universes" SET "slug" = trim(both '-' from regexp_replace(lower(normalize("name", NFC)), '[^[:alnum:]]+', '-', 'g'));--> statement-breakpoint
-- A name without letters or digits gets the universe's ID until it is renamed
UPDATE "universes" SET "slug" = "id"::text WHERE "slug" = '';--> statement-breakpoint
-- Names already shared: the oldest universe keeps the slug, and the others get -2, -3 and so on until they are renamed
UPDATE "universes" SET "slug" = "numbered"."slug" || '-' || "numbered"."position"
FROM (
	SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS "position"
	FROM "universes"
) AS "numbered"
WHERE "universes"."id" = "numbered"."id" AND "numbered"."position" > 1;--> statement-breakpoint
ALTER TABLE "universes" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "universes_slug_unique" ON "universes" USING btree ("slug");