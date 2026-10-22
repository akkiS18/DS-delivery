-- Stage 5B - restaurant catalog management. Additive; no product, category or order row is deleted or rewritten.
ALTER TABLE "Product" ADD COLUMN "archivedAt" TIMESTAMPTZ(3), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- An archived product can never be orderable (customer, bot and Stage 4B acceptance all test "isAvailable").
-- Valid for every existing row because archivedAt is NULL for all of them.
ALTER TABLE "Product" ADD CONSTRAINT "Product_archived_unavailable" CHECK ("archivedAt" IS NULL OR "isAvailable" = false);

-- Duplicate create requests (double tap, retry) collide here instead of creating twins.
-- FAILS (rolling the migration back, data unchanged) if a restaurant already has two live products / two categories
-- whose names are equal ignoring case. Check first:
--   SELECT "restaurantId", lower("name"), count(*) FROM "Product" WHERE "archivedAt" IS NULL GROUP BY 1,2 HAVING count(*) > 1;
--   SELECT "restaurantId", lower("name"), count(*) FROM "Category" GROUP BY 1,2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "Product_active_name_per_restaurant" ON "Product"("restaurantId", lower("name")) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "Category_name_per_restaurant" ON "Category"("restaurantId", lower("name"));

CREATE TABLE "CatalogEvent" (
 "id" TEXT NOT NULL,
 "restaurantId" TEXT NOT NULL,
 "entity" TEXT NOT NULL,
 "entityId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "actorSessionId" TEXT NOT NULL,
 "before" JSONB,
 "after" JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CatalogEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogEvent_restaurantId_createdAt_idx" ON "CatalogEvent"("restaurantId","createdAt");
CREATE INDEX "CatalogEvent_entity_entityId_createdAt_idx" ON "CatalogEvent"("entity","entityId","createdAt");
ALTER TABLE "CatalogEvent" ADD CONSTRAINT "CatalogEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
