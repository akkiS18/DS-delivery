-- v0.5 - separate durable taxi dispatch lifecycle from food preparation.
ALTER TABLE "Restaurant" ADD COLUMN "pickupAddress" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "pickupPhone" TEXT;
ALTER TABLE "TaxiCompany" ADD COLUMN "operatorTelegramUserId" TEXT;
ALTER TABLE "TaxiCompany" ADD COLUMN "operatorLinkedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "TaxiCompany_operatorTelegramUserId_key" ON "TaxiCompany"("operatorTelegramUserId");

CREATE TYPE "TaxiDispatchStatus" AS ENUM
  ('SCHEDULED','SENDING','REQUESTED','CANCELLATION_PENDING','ASSIGNED','DECLINED','NEEDS_HELP');
CREATE TABLE "TaxiDispatch" (
 "id" TEXT NOT NULL,
 "orderId" TEXT NOT NULL,
 "taxiCompanyId" TEXT NOT NULL,
 "attemptNo" INTEGER NOT NULL,
 "status" "TaxiDispatchStatus" NOT NULL DEFAULT 'SCHEDULED',
 "dueAt" TIMESTAMPTZ(3) NOT NULL,
 "leaseAt" TIMESTAMPTZ(3),
 "sentAt" TIMESTAMPTZ(3),
 "expiresAt" TIMESTAMPTZ(3),
 "respondedAt" TIMESTAMPTZ(3),
 "cancelNoticeAt" TIMESTAMPTZ(3),
 "cancelNoticeTries" INTEGER NOT NULL DEFAULT 0,
 "telegramMessageId" INTEGER,
 "sendTries" INTEGER NOT NULL DEFAULT 0,
 "customerNotifiedAt" TIMESTAMPTZ(3),
 "staffNotifiedAt" TIMESTAMPTZ(3),
 "adminNotifiedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "TaxiDispatch_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TaxiDispatch" ADD CONSTRAINT "TaxiDispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxiDispatch" ADD CONSTRAINT "TaxiDispatch_taxiCompanyId_fkey" FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TaxiDispatch_orderId_attemptNo_key" ON "TaxiDispatch"("orderId","attemptNo");
CREATE INDEX "TaxiDispatch_status_dueAt_idx" ON "TaxiDispatch"("status","dueAt");
CREATE INDEX "TaxiDispatch_orderId_status_idx" ON "TaxiDispatch"("orderId","status");
-- Prevent concurrent processes from assigning two active operators to one order.
CREATE UNIQUE INDEX "TaxiDispatch_only_one_active_per_order" ON "TaxiDispatch"("orderId")
 WHERE "status" IN ('SCHEDULED','SENDING','REQUESTED','CANCELLATION_PENDING','ASSIGNED','NEEDS_HELP');
