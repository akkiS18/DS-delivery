-- Stage 6E: durable application-level notification de-duplication. One row per (event, recipient chat) idempotency key.
-- Additive. `dedupeKey` is unique, so concurrent workers/processes can never both own the same logical notification.
CREATE TABLE "NotificationLog" (
  "id"                TEXT NOT NULL,
  "dedupeKey"         TEXT NOT NULL,
  "kind"              TEXT NOT NULL,
  "chatId"            TEXT NOT NULL,
  "orderId"           TEXT,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "claimedAt"         TIMESTAMPTZ(3),
  "sentAt"            TIMESTAMPTZ(3),
  "telegramMessageId" INTEGER,
  "lastError"         TEXT,
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");
CREATE INDEX "NotificationLog_orderId_idx" ON "NotificationLog"("orderId");
