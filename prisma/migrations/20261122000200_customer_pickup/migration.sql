-- Owner request 2026-11-22: a third delivery choice besides taxi and walking, "O'zim olib ketaman" — the customer collects the order at
-- the restaurant. The customer chooses it at checkout (deliveryPreference = PICKUP), so the order is a pickup order from the start
-- (deliveryMode = PICKUP): no taxi is ever called, and the restaurant completes it with "Mijozga berildi" (pickedUpAt).
-- Additive: one new column per table with a constant default (no table rewrite); the two value-list checks are widened, never narrowed,
-- so every existing row still satisfies them.
ALTER TABLE "Restaurant" ADD COLUMN "customerPickupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN "pickedUpAt" TIMESTAMPTZ(3);

ALTER TABLE "Order" DROP CONSTRAINT "Order_deliveryPreference_valid";
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryPreference_valid" CHECK ("deliveryPreference" IN ('TAXI', 'WALK_OK', 'PICKUP'));
ALTER TABLE "Order" DROP CONSTRAINT "Order_deliveryMode_valid";
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryMode_valid" CHECK ("deliveryMode" IN ('TAXI', 'SELF', 'PICKUP'));
-- Pickup is the customer's choice and nobody else's: the mode is PICKUP exactly when the customer asked for it (the restaurant cannot turn
-- a delivery into a pickup, and a pickup order cannot fall back to a taxi).
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickup_consistent" CHECK (("deliveryPreference" = 'PICKUP') = ("deliveryMode" = 'PICKUP'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_picked_up_only_pickup" CHECK ("pickedUpAt" IS NULL OR "deliveryMode" = 'PICKUP');

-- A pickup order never has a taxi either: the existing dispatch trigger now refuses both restaurant-delivered and pickup orders.
CREATE OR REPLACE FUNCTION "taxi_dispatch_not_for_self_delivery"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Order" WHERE "id" = NEW."orderId" AND "deliveryMode" IN ('SELF', 'PICKUP')) THEN
    RAISE EXCEPTION 'taxi dispatch for a self-delivered or pickup order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
