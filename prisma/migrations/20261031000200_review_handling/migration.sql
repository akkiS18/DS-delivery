-- Stage 8C: an administrator can close a REVIEW_REQUIRED incoming transaction with a recorded decision and note.
-- Additive only. `status` is untouched (nothing else reads handled-ness); a handled row keeps status REVIEW_REQUIRED for history.

ALTER TABLE "IncomingTransaction"
  ADD COLUMN "handledAt"     TIMESTAMPTZ(3),
  ADD COLUMN "handledBy"     TEXT,
  ADD COLUMN "handledAction" TEXT,
  ADD COLUMN "handledNote"   TEXT;

-- all four or none, only for rows that were in review, from a fixed set of decisions, with a real note
ALTER TABLE "IncomingTransaction" ADD CONSTRAINT "IncomingTransaction_handling_complete" CHECK (
  ("handledAt" IS NULL AND "handledBy" IS NULL AND "handledAction" IS NULL AND "handledNote" IS NULL)
  OR ("handledAt" IS NOT NULL AND "handledBy" IS NOT NULL AND "status" = 'REVIEW_REQUIRED'
      AND "handledAction" IS NOT NULL AND "handledAction" IN ('NOT_OURS', 'REFUNDED', 'ORDER_RESOLVED', 'OTHER')
      AND "handledNote" IS NOT NULL AND char_length("handledNote") BETWEEN 10 AND 300)
);
CREATE INDEX "IncomingTransaction_status_handledAt_receivedAt_idx" ON "IncomingTransaction" ("status", "handledAt", "receivedAt");
