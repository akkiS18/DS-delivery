-- Stage 9: the customer's "I received my order" confirmation (optional timestamp). Additive.
ALTER TABLE "Order" ADD COLUMN "customerReceivedAt" TIMESTAMPTZ(3);
