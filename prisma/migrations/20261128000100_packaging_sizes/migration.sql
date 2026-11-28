-- Owner request 2026-11-28 (Bobosher Osh): the takeaway container ("soboy idish") comes in sizes. A small one holds 3 osh (5 000 so'm), a big
-- one holds 6 osh (10 000 so'm); the server picks them by the number of osh in the basket (cheapest set, then the fewest containers).
-- Additive: two nullable columns, no default, no rewrite. Every existing row keeps NULL = the old rule (one container per dish unit), so
-- nothing changes for any restaurant until its packaging products get a capacity.
ALTER TABLE "Product" ADD COLUMN "packagingCapacity" INTEGER;
ALTER TABLE "Product" ADD COLUMN "packagingBaseId" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingBaseId_fkey" FOREIGN KEY ("packagingBaseId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Product_packagingBaseId_idx" ON "Product"("packagingBaseId");
-- Sane values only: a capacity is 1..100 portions, and a size never points at itself.
ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingCapacity_valid" CHECK ("packagingCapacity" IS NULL OR ("packagingCapacity" BETWEEN 1 AND 100));
ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingBase_not_self" CHECK ("packagingBaseId" IS NULL OR "packagingBaseId" <> "id");
