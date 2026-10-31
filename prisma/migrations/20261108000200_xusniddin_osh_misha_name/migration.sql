-- Owner request 2026-10-31: the restaurant is also known as "Misha osh"; show both names. Appends to whatever the current name is, only for this
-- slug, only once. A no-op in any database that has no such restaurant (local, test, staging).
UPDATE "Restaurant"
SET "name" = "name" || ' (Misha osh)'
WHERE "slug" = 'xusniddin-osh' AND "name" NOT ILIKE '%Misha osh%';
