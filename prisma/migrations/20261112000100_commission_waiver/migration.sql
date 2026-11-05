-- Commission waiver (owner decision 2026-11-05): the administrator can excuse the platform fee of ONE delivered order (e.g. the owner's own order).
-- The commission ledger itself stays untouched (append-only); a waiver is a separate append-only record that every balance and payout ignores.
-- Additive only: one new table, no change to existing rows.
CREATE TABLE "CommissionWaiver" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "amountSom" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "waivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionWaiver_pkey" PRIMARY KEY ("id")
);

-- At most one waiver per ledger entry (also the backstop against a double tap / two admins).
CREATE UNIQUE INDEX "CommissionWaiver_entryId_key" ON "CommissionWaiver"("entryId");
CREATE INDEX "CommissionWaiver_restaurantId_createdAt_idx" ON "CommissionWaiver"("restaurantId", "createdAt");

ALTER TABLE "CommissionWaiver" ADD CONSTRAINT "CommissionWaiver_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CommissionEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionWaiver" ADD CONSTRAINT "CommissionWaiver_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The amount can only be the entry's own amount, and a reason is required.
ALTER TABLE "CommissionWaiver" ADD CONSTRAINT "CommissionWaiver_amount_positive" CHECK ("amountSom" > 0);
ALTER TABLE "CommissionWaiver" ADD CONSTRAINT "CommissionWaiver_reason_present" CHECK (length(btrim("reason")) >= 10);

-- Append-only, like the ledger it refers to (same function: UPDATE/DELETE refused; DELETE only inside the test-suite cleanup switch).
CREATE TRIGGER "CommissionWaiver_append_only" BEFORE UPDATE OR DELETE ON "CommissionWaiver"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
