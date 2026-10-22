-- Stage 6D (2/2): operator acceptance / dispatch / delivery audit columns, secure operator link codes, and the
-- "one active dispatch per order" guard widened to the new states. Additive: no existing row is rewritten.
ALTER TABLE "TaxiDispatch"
  ADD COLUMN "acceptedAt"   TIMESTAMPTZ(3),
  ADD COLUMN "acceptedBy"   TEXT,
  ADD COLUMN "dispatchedAt" TIMESTAMPTZ(3),
  ADD COLUMN "dispatchedBy" TEXT,
  ADD COLUMN "deliveredAt"  TIMESTAMPTZ(3),
  ADD COLUMN "deliveredBy"  TEXT;

-- Only the SHA-256 of a code is stored; the plaintext is shown once to the administrator who creates it.
CREATE TABLE "TaxiOperatorInvite" (
  "id"               TEXT NOT NULL,
  "taxiCompanyId"    TEXT NOT NULL,
  "codeHash"         TEXT NOT NULL,
  "expiresAt"        TIMESTAMPTZ(3) NOT NULL,
  "usedAt"           TIMESTAMPTZ(3),
  "usedByTelegramId" TEXT,
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxiOperatorInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxiOperatorInvite_codeHash_key" ON "TaxiOperatorInvite"("codeHash");
CREATE INDEX "TaxiOperatorInvite_taxiCompanyId_idx" ON "TaxiOperatorInvite"("taxiCompanyId");
ALTER TABLE "TaxiOperatorInvite" ADD CONSTRAINT "TaxiOperatorInvite_taxiCompanyId_fkey"
  FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same guard as before plus ACCEPTED and DELIVERED (a delivered order can never get another dispatch). Existing rows
-- cannot violate it: the predicate only grows by values no row has yet.
DROP INDEX "TaxiDispatch_only_one_active_per_order";
CREATE UNIQUE INDEX "TaxiDispatch_only_one_active_per_order" ON "TaxiDispatch"("orderId")
 WHERE "status" IN ('SCHEDULED','SENDING','REQUESTED','ACCEPTED','CANCELLATION_PENDING','ASSIGNED','NEEDS_HELP','DELIVERED');
