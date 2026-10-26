-- Support chat inside the customer apps (Mini App and Android). Additive.
-- customerSeenAt: when the customer last opened the ticket (unread = an admin message or the resolution is newer).
ALTER TABLE "SupportTicket" ADD COLUMN "customerSeenAt" TIMESTAMPTZ(3);

-- A message written in an app has no Telegram message id; it is deduplicated by the client's own key instead.
ALTER TABLE "SupportTicketMessage" ALTER COLUMN "telegramMessageId" DROP NOT NULL;
ALTER TABLE "SupportTicketMessage" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "SupportTicketMessage_senderTelegramId_clientKey_key" ON "SupportTicketMessage"("senderTelegramId","clientKey");
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_has_origin" CHECK ("telegramMessageId" IS NOT NULL OR "clientKey" IS NOT NULL);
