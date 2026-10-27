-- Table reservations (owner request 2026-10-27): the customer reserves a table at a restaurant and pays a deposit to the restaurant's card.
-- The deposit is paid through the SAME payment engine as an order (a Payment with no order, the restaurant's card, matched from the bank signal),
-- so the amount/card allocation rules, the cooldowns and the automatic confirmation policy all apply unchanged.
-- Additive only: two new columns on "Restaurant" (off by default) and one new table.

ALTER TABLE "Restaurant" ADD COLUMN "reservationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Restaurant" ADD COLUMN "reservationDepositSom" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_reservationDepositSom_range" CHECK ("reservationDepositSom" BETWEEN 1000 AND 5000000);

CREATE TABLE "Reservation" (
 "id" TEXT NOT NULL,
 "code" TEXT NOT NULL,
 "restaurantId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL,
 "paymentId" TEXT NOT NULL,
 "checkoutKey" TEXT,
 "startsAt" TIMESTAMPTZ(3) NOT NULL,
 "partySize" INTEGER NOT NULL,
 "note" TEXT,
 "phoneSnapshot" TEXT NOT NULL,
 "nameSnapshot" TEXT,
 "depositSom" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
 "paidAt" TIMESTAMPTZ(3),
 "paidBy" TEXT,
 "restaurantNotifiedAt" TIMESTAMPTZ(3),
 "restaurantSeenAt" TIMESTAMPTZ(3),
 "cancelledAt" TIMESTAMPTZ(3),
 "cancelReason" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "Reservation_status_valid" CHECK ("status" IN ('PENDING_PAYMENT','PAID','EXPIRED','CANCELLED')),
 CONSTRAINT "Reservation_party_range" CHECK ("partySize" BETWEEN 1 AND 100),
 CONSTRAINT "Reservation_deposit_positive" CHECK ("depositSom" > 0),
 CONSTRAINT "Reservation_paid_has_time" CHECK ("status" <> 'PAID' OR "paidAt" IS NOT NULL),
 CONSTRAINT "Reservation_cancelled_has_time" CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation"("code");
CREATE UNIQUE INDEX "Reservation_paymentId_key" ON "Reservation"("paymentId");
CREATE UNIQUE INDEX "Reservation_checkoutKey_key" ON "Reservation"("checkoutKey");
CREATE INDEX "Reservation_restaurantId_startsAt_idx" ON "Reservation"("restaurantId", "startsAt");
CREATE INDEX "Reservation_customerId_createdAt_idx" ON "Reservation"("customerId", "createdAt");
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
