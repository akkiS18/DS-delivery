-- The restaurant states, after the payment, in how many minutes the food will be ready. Additive: two nullable columns, no backfill.
ALTER TABLE "Order" ADD COLUMN "prepChosenMinutes" INTEGER;
ALTER TABLE "Order" ADD COLUMN "prepChosenAt" TIMESTAMPTZ(3);
