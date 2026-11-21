-- Owner decision 2026-11-21: "Yaqin, piyoda mumkin" for every restaurant, not only Sifat Food.
-- New restaurants get it by default; the restaurant still decides at "Tayyor" (O'zimiz yetkazamiz / Taksi chaqirish).
-- Applied by hand on production 2026-11-21 (same two statements); re-running is harmless.
ALTER TABLE "Restaurant" ALTER COLUMN "walkingDeliveryEnabled" SET DEFAULT true;
UPDATE "Restaurant" SET "walkingDeliveryEnabled" = true WHERE "walkingDeliveryEnabled" = false;
