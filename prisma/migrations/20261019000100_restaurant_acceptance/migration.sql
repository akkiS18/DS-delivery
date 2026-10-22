-- Stage 4B-1 - restaurant acceptance before payment. Additive; existing rows and statuses are untouched.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'WAITING_RESTAURANT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RESTAURANT_REJECTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RESTAURANT_EXPIRED';

ALTER TABLE "Order"
 ADD COLUMN "paymentIsTest" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "restaurantDeadlineAt" TIMESTAMPTZ(3),
 ADD COLUMN "acceptedAt" TIMESTAMPTZ(3),
 ADD COLUMN "acceptedBy" TEXT,
 ADD COLUMN "estimatedPrepMinutes" INTEGER,
 ADD COLUMN "rejectedAt" TIMESTAMPTZ(3),
 ADD COLUMN "rejectedBy" TEXT,
 ADD COLUMN "rejectReason" TEXT;
CREATE INDEX "Order_status_restaurantDeadlineAt_idx" ON "Order"("status","restaurantDeadlineAt");

-- Backstop for the application rule: no payment attempt may be created for an order the restaurant has
-- not accepted. (Payment.orderId is already UNIQUE, so an order never gets a second attempt.)
-- The new enum values are only referenced at run time, after this migration has committed.
CREATE FUNCTION "payment_requires_accepted_order"() RETURNS trigger AS $$
BEGIN
 IF NEW."orderId" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "Order" o WHERE o."id" = NEW."orderId"
   AND o."status"::text IN ('WAITING_RESTAURANT','RESTAURANT_REJECTED','RESTAURANT_EXPIRED')) THEN
  RAISE EXCEPTION 'Payment requires a restaurant-accepted order';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "Payment_requires_accepted_order" BEFORE INSERT ON "Payment"
 FOR EACH ROW EXECUTE FUNCTION "payment_requires_accepted_order"();

-- Order lines are immutable price/product snapshots. The only allowed change is the existing
-- ON DELETE SET NULL of "productId" when a product is deleted.
CREATE FUNCTION "order_item_immutable"() RETURNS trigger AS $$
BEGIN
 IF NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."name" IS DISTINCT FROM OLD."name"
  OR NEW."unitSom" IS DISTINCT FROM OLD."unitSom" OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
  OR NEW."subtotalSom" IS DISTINCT FROM OLD."subtotalSom"
  OR (NEW."productId" IS DISTINCT FROM OLD."productId" AND NEW."productId" IS NOT NULL) THEN
  RAISE EXCEPTION 'OrderItem is an immutable snapshot';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "OrderItem_immutable" BEFORE UPDATE ON "OrderItem"
 FOR EACH ROW EXECUTE FUNCTION "order_item_immutable"();
