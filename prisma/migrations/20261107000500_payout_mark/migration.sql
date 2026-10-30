-- "O'tkazdim" mark for the daily payout report (additive: one new table). One live mark per restaurant and Tashkent day.
CREATE TABLE "PayoutMark" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "amountSom" INTEGER NOT NULL,
    "markedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBy" TEXT,
    "revokeNote" TEXT,

    CONSTRAINT "PayoutMark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayoutMark_day_format" CHECK ("day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT "PayoutMark_amount_positive" CHECK ("amountSom" > 0),
    CONSTRAINT "PayoutMark_revoke_consistent" CHECK (("revokedAt" IS NULL) = ("revokedBy" IS NULL))
);

ALTER TABLE "PayoutMark" ADD CONSTRAINT "PayoutMark_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PayoutMark_live_key" ON "PayoutMark"("restaurantId", "day") WHERE "revokedAt" IS NULL;
CREATE INDEX "PayoutMark_restaurantId_day_idx" ON "PayoutMark"("restaurantId", "day");
