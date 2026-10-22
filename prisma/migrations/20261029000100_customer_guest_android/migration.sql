-- Customer Android MVP: guest profiles, guest sessions and the optional Telegram link.
-- Additive. Existing customers keep their telegramUserId; dropping NOT NULL cannot violate any existing row,
-- and the UNIQUE index keeps rejecting duplicate Telegram ids (Postgres allows many NULLs, which is what guests need).
ALTER TABLE "Customer" ALTER COLUMN "telegramUserId" DROP NOT NULL;
ALTER TABLE "Customer" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_not_merged_into_self" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
CREATE INDEX "Customer_mergedIntoId_idx" ON "Customer"("mergedIntoId");

CREATE TABLE "GuestSession" (
  "id"             TEXT NOT NULL,
  "customerId"     TEXT NOT NULL,
  "tokenHash"      TEXT NOT NULL,
  "installationId" TEXT,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMPTZ(3) NOT NULL,
  "revokedAt"      TIMESTAMPTZ(3),
  "revokedReason"  TEXT,
  CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuestSession_hash_len" CHECK (char_length("tokenHash") = 64)
);
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");
CREATE INDEX "GuestSession_customerId_idx" ON "GuestSession"("customerId");

CREATE TYPE "TelegramLinkStatus" AS ENUM ('CREATED', 'BOT_BOUND', 'BOT_CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "TelegramLinkAttempt" (
  "id"               TEXT NOT NULL,
  "guestCustomerId"  TEXT NOT NULL,
  "sessionId"        TEXT NOT NULL,
  "tokenHash"        TEXT NOT NULL,
  "status"           "TelegramLinkStatus" NOT NULL DEFAULT 'CREATED',
  "telegramUserId"   TEXT,
  "telegramName"     TEXT,
  "telegramUsername" TEXT,
  "targetCustomerId" TEXT,
  "mergeSummary"     JSONB,
  "expiresAt"        TIMESTAMPTZ(3) NOT NULL,
  "botBoundAt"       TIMESTAMPTZ(3),
  "botConfirmedAt"   TIMESTAMPTZ(3),
  "completedAt"      TIMESTAMPTZ(3),
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramLinkAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramLinkAttempt_hash_len" CHECK (char_length("tokenHash") = 64),
  -- a Telegram identity must exist from the moment the bot bound it
  CONSTRAINT "TelegramLinkAttempt_bound_has_identity" CHECK ("status" IN ('CREATED', 'CANCELLED', 'EXPIRED') OR "telegramUserId" IS NOT NULL)
);
ALTER TABLE "TelegramLinkAttempt" ADD CONSTRAINT "TelegramLinkAttempt_guestCustomerId_fkey" FOREIGN KEY ("guestCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TelegramLinkAttempt_tokenHash_key" ON "TelegramLinkAttempt"("tokenHash");
CREATE INDEX "TelegramLinkAttempt_guestCustomerId_status_idx" ON "TelegramLinkAttempt"("guestCustomerId", "status");
-- At most one live link attempt per guest profile, enforced by the database.
CREATE UNIQUE INDEX "TelegramLinkAttempt_one_live_per_guest" ON "TelegramLinkAttempt"("guestCustomerId") WHERE "status" IN ('CREATED', 'BOT_BOUND', 'BOT_CONFIRMED');
