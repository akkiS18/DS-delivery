-- Stage 6B: append-only platform commission ledger. Additive only; no existing row is touched.
-- Not executed by the author. If it fails, nothing else changes (new tables, functions and triggers only).

CREATE TABLE "CommissionEntry" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "orderId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'ACCRUAL',
  "amountSom" INTEGER NOT NULL,
  "orderTotalSom" INTEGER NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "proofEventId" TEXT NOT NULL,
  "accruedBy" TEXT NOT NULL,
  "accruedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionEntry_kind_valid" CHECK ("kind" = 'ACCRUAL'),
  CONSTRAINT "CommissionEntry_amount_positive" CHECK ("amountSom" > 0 AND "orderTotalSom" > 0)
);
CREATE UNIQUE INDEX "CommissionEntry_number_key" ON "CommissionEntry"("number");
-- At most one commission per order, enforced by the database (duplicate/concurrent accruals lose with 23505).
CREATE UNIQUE INDEX "CommissionEntry_orderId_key" ON "CommissionEntry"("orderId");
CREATE INDEX "CommissionEntry_restaurantId_accruedAt_idx" ON "CommissionEntry"("restaurantId", "accruedAt");
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommissionEvent" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommissionEvent_entryId_createdAt_idx" ON "CommissionEvent"("entryId", "createdAt");
ALTER TABLE "CommissionEvent" ADD CONSTRAINT "CommissionEvent_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "CommissionEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Insert guard: even a buggy caller cannot create a commission unless every earning condition holds in the database.
-- Delivery proof = the order is COMPLETED and the referenced OrderEvent records the transition to COMPLETED.
-- Taxi dispatch states, payment matching/confirmation and READY are NOT proof of delivery and are not consulted.
CREATE FUNCTION "commission_entry_guard"() RETURNS trigger AS $$
DECLARE o RECORD; p RECORD;
BEGIN
  SELECT "status"::text AS st, "restaurantId" AS rid, "paymentIsTest" AS ptest, "totalSom" AS total
    INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o.st <> 'COMPLETED' THEN
    RAISE EXCEPTION 'COMMISSION_ORDER_NOT_COMPLETED' USING ERRCODE = 'check_violation';
  END IF;
  IF o.rid <> NEW."restaurantId" OR o.ptest OR o.total <> NEW."orderTotalSom" THEN
    RAISE EXCEPTION 'COMMISSION_ORDER_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "orderId" AS oid, "status" AS st, "isTest" AS itest INTO p FROM "Payment" WHERE "id" = NEW."paymentId";
  IF NOT FOUND OR p.oid IS DISTINCT FROM NEW."orderId" OR p.st <> 'CONFIRMED_MANUAL' OR p.itest THEN
    RAISE EXCEPTION 'COMMISSION_PAYMENT_NOT_VERIFIED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."id" = NEW."proofEventId" AND e."orderId" = NEW."orderId" AND e."toStatus"::text = 'COMPLETED') THEN
    RAISE EXCEPTION 'COMMISSION_NO_DELIVERY_PROOF' USING ERRCODE = 'check_violation';
  END IF;
  -- A refund request (anything except a REJECTED one) means the money question is unresolved: no automatic commission.
  IF EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r."orderId" = NEW."orderId" AND r."status" <> 'REJECTED') THEN
    RAISE EXCEPTION 'COMMISSION_REFUND_EXISTS' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CommissionEntry_guard" BEFORE INSERT ON "CommissionEntry"
  FOR EACH ROW EXECUTE FUNCTION "commission_entry_guard"();

-- Ledger rows never change. DELETE is refused too, except inside a transaction that sets ds.ledger_cleanup = 'on'
-- (used only by the test suites to remove their own rows; anyone with that much database access could drop the trigger anyway).
CREATE FUNCTION "ledger_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ds.ledger_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'LEDGER_APPEND_ONLY' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CommissionEntry_append_only" BEFORE UPDATE OR DELETE ON "CommissionEntry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
CREATE TRIGGER "CommissionEvent_append_only" BEFORE UPDATE OR DELETE ON "CommissionEvent"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
