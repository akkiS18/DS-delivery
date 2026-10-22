-- Stage 4A - payment matching safety. Additive; nothing is deleted or rewritten.
-- Fails (without changing data) if existing rows already violate the new unique index.
ALTER TABLE "IncomingTransaction" ADD COLUMN "fingerprint" TEXT, ADD COLUMN "reviewDetails" JSONB;
CREATE UNIQUE INDEX "IncomingTransaction_matchedPaymentId_key" ON "IncomingTransaction"("matchedPaymentId");
CREATE INDEX "IncomingTransaction_fingerprint_idx" ON "IncomingTransaction"("fingerprint");

CREATE TABLE "PaymentEvent" (
 "id" TEXT NOT NULL,
 "paymentId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "fromStatus" TEXT,
 "toStatus" TEXT,
 "actorType" TEXT NOT NULL,
 "actorId" TEXT,
 "incomingTransactionId" TEXT,
 "details" JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId","createdAt");
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A real (non-test) payment can only be MATCHED_UNVERIFIED / CONFIRMED_MANUAL with a linked incoming transaction.
-- NOT VALID: enforced for every new write, existing rows are left untouched (validate manually after review).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_real_match_needs_transaction" CHECK (
 "isTest" OR "status" NOT IN ('MATCHED_UNVERIFIED','CONFIRMED_MANUAL') OR "matchedTransactionId" IS NOT NULL) NOT VALID;
ALTER TABLE "IncomingTransaction" ADD CONSTRAINT "IncomingTransaction_match_needs_payment" CHECK (
 "status" <> 'MATCHED_UNVERIFIED' OR "matchedPaymentId" IS NOT NULL) NOT VALID;
