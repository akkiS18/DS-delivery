-- v0.4: one authorized private Telegram account per restaurant.
ALTER TABLE "Restaurant" ADD COLUMN "staffTelegramUserId" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "staffLinkedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "Restaurant_staffTelegramUserId_key" ON "Restaurant"("staffTelegramUserId");

-- Explicit human verification after payment-notification matching.
ALTER TABLE "Order" ADD COLUMN "paymentVerifiedAt" TIMESTAMPTZ(3);
ALTER TABLE "Order" ADD COLUMN "paymentVerifiedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "prepMinutes" INTEGER;
ALTER TABLE "Order" ADD COLUMN "preparingStartedAt" TIMESTAMPTZ(3);
ALTER TABLE "Order" ADD COLUMN "readyAt" TIMESTAMPTZ(3);
ALTER TABLE "Order" ADD COLUMN "staffLastNotifiedStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerLastNotifiedStatus" TEXT;

CREATE TABLE "OrderEvent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orderId" TEXT NOT NULL,
 "actorTelegramId" TEXT NOT NULL,
 "actorType" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "fromStatus" "OrderStatus" NOT NULL,
 "toStatus" "OrderStatus" NOT NULL,
 "details" JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey"
 FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
