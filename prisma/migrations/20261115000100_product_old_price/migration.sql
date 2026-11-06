-- Set offers ("Lavash 1+1: 60 000 crossed out, 49 000"): a dish may carry the earlier price for DISPLAY only. Additive: one nullable column, no rewrite,
-- every existing dish keeps NULL. The amount charged is still "priceSom".
ALTER TABLE "Product" ADD COLUMN "oldPriceSom" INTEGER;
ALTER TABLE "Product" ADD CONSTRAINT "Product_oldPriceSom_positive" CHECK ("oldPriceSom" IS NULL OR "oldPriceSom" > 0);
