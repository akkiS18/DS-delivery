-- Cash on delivery: a delivered order whose cash the restaurant accepted (Payment.status CASH_ACCEPTED) owes the platform fee like a card order the
-- restaurant verified. Same guard as 20261024000100_commission_ledger, one change: the payment status may be CONFIRMED_MANUAL or CASH_ACCEPTED.
-- Everything else (COMPLETED order + audited delivery event, non-test, same restaurant/total, no open refund) is unchanged.
CREATE OR REPLACE FUNCTION "commission_entry_guard"() RETURNS trigger AS $$
DECLARE o RECORD; p RECORD;
BEGIN
  SELECT "status"::text AS st, "restaurantId" AS rid, "paymentIsTest" AS ptest, "totalSom" AS total
    INTO o FROM "Order" WHERE "id" = NEW."orderId";
  IF NOT FOUND OR o.st <> 'COMPLETED' THEN
    RAISE EXCEPTION 'COMMISSION_ORDER_NOT_COMPLETED' USING ERRCODE = 'check_violation';
  END IF;
  IF o.rid <> NEW."restaurantId" OR o.ptest OR o.total <> NEW."orderTotalSom" THEN
    RAISE EXCEPTION 'COMMISSION_ORDER_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "orderId" AS oid, "status" AS st, "isTest" AS itest INTO p FROM "Payment" WHERE "id" = NEW."paymentId";
  IF NOT FOUND OR p.oid IS DISTINCT FROM NEW."orderId" OR p.st NOT IN ('CONFIRMED_MANUAL', 'CASH_ACCEPTED') OR p.itest THEN
    RAISE EXCEPTION 'COMMISSION_PAYMENT_NOT_VERIFIED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."id" = NEW."proofEventId" AND e."orderId" = NEW."orderId" AND e."toStatus"::text = 'COMPLETED') THEN
    RAISE EXCEPTION 'COMMISSION_NO_DELIVERY_PROOF' USING ERRCODE = 'check_violation';
  END IF;
  -- A refund request (anything except a REJECTED one) means the money question is unresolved: no automatic commission.
  IF EXISTS (SELECT 1 FROM "RefundRequest" r WHERE r."orderId" = NEW."orderId" AND r."status" <> 'REJECTED') THEN
    RAISE EXCEPTION 'COMMISSION_REFUND_EXISTS' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
