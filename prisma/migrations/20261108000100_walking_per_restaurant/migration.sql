-- "Yaqin, piyoda mumkin" is offered only by restaurants that switched it on (owner decision 2026-10-31: Sifat Food only, off everywhere else).
-- Additive: one NOT NULL column with a default; no existing row changes except the one the owner named.
ALTER TABLE "Restaurant" ADD COLUMN "walkingDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Restaurant" SET "walkingDeliveryEnabled" = true WHERE "slug" = 'sifat-food';
