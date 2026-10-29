-- Platform card pool (owner decision 2026-10-30): a restaurant can be paid on the platform own cards (Card.restaurantId IS NULL).
-- Additive: one defaulted column, no data change, every existing restaurant keeps using its own cards.
ALTER TABLE "Restaurant" ADD COLUMN "collectsToPlatform" BOOLEAN NOT NULL DEFAULT false;
