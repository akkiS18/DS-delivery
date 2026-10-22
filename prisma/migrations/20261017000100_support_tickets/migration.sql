-- Stage 3B - support tickets with two-admin atomic claiming.
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED');

CREATE TABLE "SupportTicket" (
 "id" TEXT NOT NULL,
 "number" SERIAL NOT NULL,
 "orderId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL,
 "message" TEXT NOT NULL,
 "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
 "assignedAdminTelegramId" TEXT,
 "assignedAdminName" TEXT,
 "claimedAt" TIMESTAMPTZ(3),
 "resolvedAt" TIMESTAMPTZ(3),
 "customerNotifiedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
 -- An OPEN ticket has no owner; every other state has one.
 CONSTRAINT "SupportTicket_owner_matches_status" CHECK (
  ("status" = 'OPEN' AND "assignedAdminTelegramId" IS NULL)
  OR ("status" <> 'OPEN' AND "assignedAdminTelegramId" IS NOT NULL))
);
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status","createdAt");
CREATE INDEX "SupportTicket_customerId_createdAt_idx" ON "SupportTicket"("customerId","createdAt");
CREATE INDEX "SupportTicket_orderId_idx" ON "SupportTicket"("orderId");
-- At most one unresolved ticket per order (blocks spam and double-submit races).
CREATE UNIQUE INDEX "SupportTicket_one_active_per_order" ON "SupportTicket"("orderId")
 WHERE "status" IN ('OPEN','IN_PROGRESS');
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SupportTicketNotification" (
 "id" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "adminTelegramId" TEXT NOT NULL,
 "messageId" INTEGER NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportTicketNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicketNotification_ticketId_adminTelegramId_key" ON "SupportTicketNotification"("ticketId","adminTelegramId");
ALTER TABLE "SupportTicketNotification" ADD CONSTRAINT "SupportTicketNotification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupportTicketEvent" (
 "id" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "actorTelegramId" TEXT NOT NULL,
 "actorType" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "fromStatus" "SupportTicketStatus",
 "toStatus" "SupportTicketStatus",
 "details" JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId","createdAt");
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupportCallbackLog" (
 "callbackQueryId" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "actorTelegramId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportCallbackLog_pkey" PRIMARY KEY ("callbackQueryId")
);
CREATE INDEX "SupportCallbackLog_createdAt_idx" ON "SupportCallbackLog"("createdAt");
