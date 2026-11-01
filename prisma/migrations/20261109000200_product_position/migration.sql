-- Owner request 2026-11-02: the customer menu lists dishes in an order the owner chooses (not only by name). Additive: every dish keeps position 0
-- (= by name, as before).
ALTER TABLE "Product" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
