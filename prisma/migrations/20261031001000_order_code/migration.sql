-- Public order reference: a short random code (5 characters, consonants and digits only, so it never spells a word) shown to customers,
-- restaurants and taxi operators INSTEAD of the sequential Order.number, which would reveal how many orders the platform or a restaurant has.
-- Order.number stays as the internal sequence. Additive: new column, new function; existing orders are backfilled.
CREATE OR REPLACE FUNCTION gen_order_code() RETURNS TEXT AS $$
DECLARE
  chars CONSTANT TEXT := 'BCDFGHJKMNPQRSTVWXYZ23456789';
  result TEXT;
  i INT;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..5 LOOP
      result := result || substr(chars, 1 + floor(random() * length(chars))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "Order" WHERE "code" = result);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE "Order" ADD COLUMN "code" TEXT;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "Order" WHERE "code" IS NULL LOOP
    UPDATE "Order" SET "code" = gen_order_code() WHERE "id" = r."id";
  END LOOP;
END $$;

ALTER TABLE "Order" ALTER COLUMN "code" SET DEFAULT gen_order_code();
ALTER TABLE "Order" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");
