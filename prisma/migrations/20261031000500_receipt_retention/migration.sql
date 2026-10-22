-- Stage 8C: refund receipt retention. A confirmed refund's receipt photo is deleted from the volume after RECEIPT_RETENTION_DAYS; the row keeps
-- the type, size and SHA-256 (not personal data; the unique index still stops the same image from proving a second refund) and records when the
-- photo was purged. Additive; the replacement CHECK accepts every existing row (a stored key with no purge time). Every column is tested with
-- IS [NOT] NULL first: a comparison with NULL yields NULL, and a CHECK lets NULL through, which would admit half-filled rows.

ALTER TABLE "RefundRequest" ADD COLUMN "receiptPurgedAt" TIMESTAMPTZ(3);

ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_receipt_complete";
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_receipt_complete" CHECK (
  ("receiptKey" IS NULL AND "receiptMime" IS NULL AND "receiptBytes" IS NULL AND "receiptSha256" IS NULL AND "receiptPurgedAt" IS NULL)
  OR ("receiptMime" IN ('image/jpeg','image/png','image/webp')
      AND "receiptBytes" BETWEEN 1024 AND 5242880
      AND "receiptSha256" ~ '^[0-9a-f]{64}$'
      AND (("receiptKey" IS NOT NULL AND "receiptKey" ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$' AND "receiptPurgedAt" IS NULL)
           OR ("receiptKey" IS NULL AND "receiptPurgedAt" IS NOT NULL)))
);
