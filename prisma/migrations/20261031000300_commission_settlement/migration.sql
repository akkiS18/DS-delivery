-- Stage 8C: weekly commission settlement. A settlement records that an administrator verified in the bank that a restaurant paid the platform
-- the commission for a set of ledger entries. Additive and append-only: ledger entries are never modified (they are immutable), the join table
-- says which entries a settlement covers, and each entry can be covered once.

CREATE TABLE "CommissionSettlement" (
  "id"           TEXT NOT NULL,
  "number"       SERIAL NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "cutoffAt"     TIMESTAMPTZ(3) NOT NULL,
  "entryCount"   INTEGER NOT NULL,
  "amountSom"    INTEGER NOT NULL,
  "confirmedBy"  TEXT NOT NULL,
  "note"         TEXT NOT NULL,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionSettlement_positive" CHECK ("entryCount" > 0 AND "amountSom" > 0),
  CONSTRAINT "CommissionSettlement_note_len" CHECK (char_length("note") BETWEEN 10 AND 300),
  CONSTRAINT "CommissionSettlement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommissionSettlement_number_key" ON "CommissionSettlement"("number");
CREATE INDEX "CommissionSettlement_restaurantId_createdAt_idx" ON "CommissionSettlement"("restaurantId", "createdAt");

CREATE TABLE "CommissionSettlementEntry" (
  "settlementId" TEXT NOT NULL,
  "entryId"      TEXT NOT NULL,
  CONSTRAINT "CommissionSettlementEntry_pkey" PRIMARY KEY ("settlementId", "entryId"),
  CONSTRAINT "CommissionSettlementEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CommissionSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommissionSettlementEntry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CommissionEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- one entry is settled at most once
CREATE UNIQUE INDEX "CommissionSettlementEntry_entryId_key" ON "CommissionSettlementEntry"("entryId");

-- A settlement can only cover its own restaurant's entries.
CREATE FUNCTION "commission_settlement_entry_guard"() RETURNS trigger AS $$
DECLARE s TEXT; e TEXT;
BEGIN
  SELECT "restaurantId" INTO s FROM "CommissionSettlement" WHERE "id" = NEW."settlementId";
  SELECT "restaurantId" INTO e FROM "CommissionEntry" WHERE "id" = NEW."entryId";
  IF s IS NULL OR e IS NULL OR s <> e THEN
    RAISE EXCEPTION 'SETTLEMENT_RESTAURANT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CommissionSettlementEntry_guard" BEFORE INSERT ON "CommissionSettlementEntry"
  FOR EACH ROW EXECUTE FUNCTION "commission_settlement_entry_guard"();

-- Same append-only rule as the ledger (ledger_append_only is defined in 20261024000100_commission_ledger).
CREATE TRIGGER "CommissionSettlement_append_only" BEFORE UPDATE OR DELETE ON "CommissionSettlement"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
CREATE TRIGGER "CommissionSettlementEntry_append_only" BEFORE UPDATE OR DELETE ON "CommissionSettlementEntry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
