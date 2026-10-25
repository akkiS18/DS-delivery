-- Cash on delivery (owner decision 2026-10-25). Additive: one column that defaults to the existing behaviour (CARD), no backfill.
-- A CASH payment goes CASH_PENDING (waiting for the restaurant) -> CASH_ACCEPTED (restaurant accepted; cooking and the taxi may proceed),
-- or EXPIRED / CANCELLED. It never holds a card and is never matched against bank e-mails.
ALTER TABLE "Payment" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'CARD';
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_method_valid" CHECK ("method" IN ('CARD', 'CASH'));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cash_has_no_card" CHECK ("method" <> 'CASH' OR ("cardId" IS NULL AND "matchedTransactionId" IS NULL));
