-- Stage 4B-2 - customer price consent and cancellation while waiting. Additive.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'WAITING_CUSTOMER_CONSENT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_CANCELLED';

ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMPTZ(3), ADD COLUMN "cancelledBy" TEXT, ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "supersededAt" TIMESTAMPTZ(3);

CREATE TABLE "OrderPriceRevision" (
 "id" TEXT NOT NULL,
 "orderId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROPOSED',
 "proposedBy" TEXT NOT NULL,
 "proposedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "respondedAt" TIMESTAMPTZ(3),
 "oldTotalSom" INTEGER NOT NULL,
 "newTotalSom" INTEGER NOT NULL,
 "prepMinutes" INTEGER NOT NULL,
 "previousLines" JSONB NOT NULL,
 "lines" JSONB NOT NULL,
 CONSTRAINT "OrderPriceRevision_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OrderPriceRevision_status_check" CHECK ("status" IN ('PROPOSED','ACCEPTED','DECLINED','EXPIRED','VOID'))
);
CREATE INDEX "OrderPriceRevision_orderId_status_idx" ON "OrderPriceRevision"("orderId","status");
CREATE INDEX "OrderPriceRevision_status_expiresAt_idx" ON "OrderPriceRevision"("status","expiresAt");
CREATE UNIQUE INDEX "OrderPriceRevision_one_proposed_per_order" ON "OrderPriceRevision"("orderId") WHERE "status" = 'PROPOSED';
ALTER TABLE "OrderPriceRevision" ADD CONSTRAINT "OrderPriceRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payment backstop now also covers the consent and cancelled states (new enum values are used only at run time).
CREATE OR REPLACE FUNCTION "payment_requires_accepted_order"() RETURNS trigger AS $$
BEGIN
 IF NEW."orderId" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "Order" o WHERE o."id" = NEW."orderId"
   AND o."status"::text IN ('WAITING_RESTAURANT','WAITING_CUSTOMER_CONSENT','CUSTOMER_CANCELLED','RESTAURANT_REJECTED','RESTAURANT_EXPIRED')) THEN
  RAISE EXCEPTION 'Payment requires a restaurant-accepted order';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Order lines stay immutable; the only allowed changes are SET NULL of productId (product deleted)
-- and the one-way marking of "supersededAt" (history is kept, never rewritten or un-superseded).
CREATE OR REPLACE FUNCTION "order_item_immutable"() RETURNS trigger AS $$
BEGIN
 IF NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."name" IS DISTINCT FROM OLD."name"
  OR NEW."unitSom" IS DISTINCT FROM OLD."unitSom" OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
  OR NEW."subtotalSom" IS DISTINCT FROM OLD."subtotalSom"
  OR (NEW."productId" IS DISTINCT FROM OLD."productId" AND NEW."productId" IS NOT NULL)
  OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt") THEN
  RAISE EXCEPTION 'OrderItem is an immutable snapshot';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
