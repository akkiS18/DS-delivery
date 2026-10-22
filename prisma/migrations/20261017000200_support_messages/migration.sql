-- Stage 3C - support conversation messages with delivery tracking. Additive.
CREATE TABLE "SupportTicketMessage" (
 "id" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "senderType" TEXT NOT NULL,
 "senderTelegramId" TEXT NOT NULL,
 "senderName" TEXT,
 "telegramMessageId" INTEGER NOT NULL,
 "text" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deliveredAt" TIMESTAMPTZ(3),
 "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "failedAt" TIMESTAMPTZ(3),
 "lastError" TEXT,
 CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SupportTicketMessage_sender_type" CHECK ("senderType" IN ('CUSTOMER','ADMIN')),
 CONSTRAINT "SupportTicketMessage_text_len" CHECK (char_length("text") BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX "SupportTicketMessage_senderTelegramId_telegramMessageId_key" ON "SupportTicketMessage"("senderTelegramId","telegramMessageId");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId","createdAt");
CREATE INDEX "SupportTicketMessage_deliveredAt_failedAt_nextAttemptAt_idx" ON "SupportTicketMessage"("deliveredAt","failedAt","nextAttemptAt");
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
