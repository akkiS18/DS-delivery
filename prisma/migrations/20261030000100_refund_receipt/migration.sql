-- Refund receipt photo: the restaurant proves a refund was sent with ONE photo of the bank receipt instead of a typed reference.
-- Additive: four nullable columns, a replacement CHECK that still accepts every legacy row (typed reference OR receipt), a receipt-integrity CHECK
-- and a partial unique index (the same image cannot prove two refunds). The only DROP is the old "sent needs typed reference" CHECK, which is
-- replaced in the same transaction by a constraint that is a superset for existing data (nothing existing can violate it).
-- The image bytes live on the server volume (RECEIPT_DIR); only the key, type, size and SHA-256 are stored here.

ALTER TABLE "RefundRequest"
  ADD COLUMN "receiptKey" TEXT,
  ADD COLUMN "receiptMime" TEXT,
  ADD COLUMN "receiptBytes" INTEGER,
  ADD COLUMN "receiptSha256" TEXT;

ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_sent_needs_reference";

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_sent_needs_proof" CHECK (
  "status" NOT IN ('SENT','CONFIRMED')
  OR ("sentBy" IS NOT NULL AND "sentAt" IS NOT NULL
      AND (("bankReference" IS NOT NULL AND char_length("bankReference") >= 4) OR "receiptSha256" IS NOT NULL))
);

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_receipt_complete" CHECK (
  ("receiptKey" IS NULL AND "receiptMime" IS NULL AND "receiptBytes" IS NULL AND "receiptSha256" IS NULL)
  OR ("receiptKey" ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'
      AND "receiptMime" IN ('image/jpeg','image/png','image/webp')
      AND "receiptBytes" BETWEEN 1024 AND 5242880
      AND "receiptSha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "RefundRequest_receiptSha256_key" ON "RefundRequest"("receiptSha256") WHERE "receiptSha256" IS NOT NULL;
