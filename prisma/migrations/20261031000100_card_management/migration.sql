-- Stage 8B: payee cards are managed by the restaurant in its app.
-- Additive only. Legacy rows keep working: they stay APPROVED, number NULL (the 16 digits came from BOT_REAL_CARD_NUMBERS_JSON).
-- A restaurant-added card starts PENDING and inactive; only an administrator's decision makes it assignable (money-redirection guard).

ALTER TABLE "Card"
  ADD COLUMN "number"          TEXT,
  ADD COLUMN "approvalStatus"  TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "decidedAt"       TIMESTAMPTZ(3),
  ADD COLUMN "decidedBy"       TEXT,
  ADD COLUMN "adminNotifiedAt" TIMESTAMPTZ(3);

ALTER TABLE "Card" ADD CONSTRAINT "Card_approval_status_valid" CHECK ("approvalStatus" IN ('PENDING', 'APPROVED', 'REJECTED'));
-- 16 digits whose last four are the Gmail-matching key (last4 is already globally unique).
ALTER TABLE "Card" ADD CONSTRAINT "Card_number_format" CHECK ("number" IS NULL OR ("number" ~ '^[0-9]{16}$' AND right("number", 4) = "last4"));
-- Nothing can be assigned from a card nobody has approved.
ALTER TABLE "Card" ADD CONSTRAINT "Card_unapproved_is_inactive" CHECK ("approvalStatus" = 'APPROVED' OR "active" = false);
-- The same 16-digit number can exist only once.
CREATE UNIQUE INDEX "Card_number_key" ON "Card" ("number") WHERE "number" IS NOT NULL;
CREATE INDEX "Card_approvalStatus_adminNotifiedAt_idx" ON "Card" ("approvalStatus", "adminNotifiedAt");

-- Append-only audit of card changes. Never deleted by the application; the number itself is not copied here.
CREATE TABLE "CardEvent" (
  "id"        TEXT NOT NULL,
  "cardId"    TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId"   TEXT,
  "details"   JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CardEvent_cardId_createdAt_idx" ON "CardEvent" ("cardId", "createdAt");
