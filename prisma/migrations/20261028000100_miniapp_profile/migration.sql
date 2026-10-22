-- Stage 7A: restaurant time zone (working hours are evaluated in it) and the customer's saved delivery addresses (Mini App profile).
-- Additive. Existing restaurants get Asia/Tashkent, the zone every current restaurant already works in.
ALTER TABLE "Restaurant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent';

CREATE TABLE "CustomerAddress" (
  "id"         TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "addressText" TEXT NOT NULL,
  "lat"        DOUBLE PRECISION,
  "lng"        DOUBLE PRECISION,
  "isDefault"  BOOLEAN NOT NULL DEFAULT false,
  "lastUsedAt" TIMESTAMPTZ(3),
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerAddress_label_len" CHECK (char_length("label") BETWEEN 1 AND 30),
  CONSTRAINT "CustomerAddress_text_len" CHECK (char_length("addressText") BETWEEN 3 AND 500),
  CONSTRAINT "CustomerAddress_coords" CHECK (("lat" IS NULL) = ("lng" IS NULL) AND ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)))
);
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");
-- At most one default address per customer, enforced by the database (not just by application code).
CREATE UNIQUE INDEX "CustomerAddress_one_default_per_customer" ON "CustomerAddress"("customerId") WHERE "isDefault";
