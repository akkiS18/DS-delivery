-- A support conversation no longer has to be about an order (owner 2026-11-07).
-- Relaxing NOT NULL is additive: every existing ticket keeps its order. The foreign key (ON DELETE CASCADE) is unchanged.
ALTER TABLE "SupportTicket" ALTER COLUMN "orderId" DROP NOT NULL;

-- At most one unresolved general (order-less) conversation per customer; the per-order partial unique index does not cover NULL orders.
-- Cannot fail on legacy data: every existing row has an order.
CREATE UNIQUE INDEX "SupportTicket_one_active_general_per_customer" ON "SupportTicket"("customerId")
  WHERE "orderId" IS NULL AND "status" IN ('OPEN','IN_PROGRESS');
