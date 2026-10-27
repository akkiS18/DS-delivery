-- Walking / self delivery (owner decision 2026-10-27). The customer may say "my home is close, the restaurant can bring it on foot"
-- (deliveryPreference = WALK_OK); only then may the restaurant, when it presses "Tayyor", deliver it itself (deliveryMode = SELF) instead of
-- calling a taxi. Everything defaults to the current taxi behaviour, so existing rows and older apps are unchanged.
-- Additive only: new columns with constant defaults (no table rewrite), no existing column changes.
ALTER TABLE "Order" ADD COLUMN "deliveryPreference" TEXT NOT NULL DEFAULT 'TAXI';
ALTER TABLE "Order" ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'TAXI';
-- When the restaurant itself reported the order delivered (the taxi path records this on the TaxiDispatch instead).
ALTER TABLE "Order" ADD COLUMN "selfDeliveredAt" TIMESTAMPTZ(3);

ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryPreference_valid" CHECK ("deliveryPreference" IN ('TAXI', 'WALK_OK'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryMode_valid" CHECK ("deliveryMode" IN ('TAXI', 'SELF'));
-- The restaurant may deliver itself only when the customer allowed it, and a delivery time exists only for self delivery.
ALTER TABLE "Order" ADD CONSTRAINT "Order_self_needs_consent" CHECK ("deliveryMode" <> 'SELF' OR "deliveryPreference" = 'WALK_OK');
ALTER TABLE "Order" ADD CONSTRAINT "Order_self_delivered_only_self" CHECK ("selfDeliveredAt" IS NULL OR "deliveryMode" = 'SELF');

-- A self-delivered order never has a taxi: refuse a dispatch row for it, whatever code path tries to create one.
CREATE FUNCTION "taxi_dispatch_not_for_self_delivery"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Order" WHERE "id" = NEW."orderId" AND "deliveryMode" = 'SELF') THEN
    RAISE EXCEPTION 'taxi dispatch for a self-delivered order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TaxiDispatch_not_for_self_delivery" BEFORE INSERT ON "TaxiDispatch"
  FOR EACH ROW EXECUTE FUNCTION "taxi_dispatch_not_for_self_delivery"();
