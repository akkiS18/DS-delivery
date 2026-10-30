-- Customer strikes and administrator block (owner decision 2026-10-30). Additive: one new table and three nullable columns on "Customer".
CREATE TABLE "CustomerStrike" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "source" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBy" TEXT,
    "revokeNote" TEXT,

    CONSTRAINT "CustomerStrike_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerStrike_source_check" CHECK ("source" IN ('ADMIN', 'RESTAURANT', 'TAXI')),
    CONSTRAINT "CustomerStrike_revoke_consistent" CHECK (("revokedAt" IS NULL) = ("revokedBy" IS NULL))
);

ALTER TABLE "CustomerStrike" ADD CONSTRAINT "CustomerStrike_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerStrike" ADD CONSTRAINT "CustomerStrike_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one strike per order and source, however often the button is tapped or the request is retried.
CREATE UNIQUE INDEX "CustomerStrike_order_source_key" ON "CustomerStrike"("orderId", "source") WHERE "orderId" IS NOT NULL;
CREATE INDEX "CustomerStrike_customerId_revokedAt_idx" ON "CustomerStrike"("customerId", "revokedAt");

ALTER TABLE "Customer" ADD COLUMN "blockedAt" TIMESTAMPTZ(3);
ALTER TABLE "Customer" ADD COLUMN "blockedBy" TEXT;
ALTER TABLE "Customer" ADD COLUMN "blockNote" TEXT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_block_consistent" CHECK (("blockedAt" IS NULL) = ("blockedBy" IS NULL));
