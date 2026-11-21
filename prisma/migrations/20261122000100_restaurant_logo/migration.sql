-- Owner request 2026-11-22: an optional square logo next to the restaurant picture. Additive: a new table, no existing row changes.
-- The wide picture stays in "RestaurantImage"; small square frames get the logo when one exists (src/modules/restaurant/image.ts).
CREATE TABLE "RestaurantLogo" (
 "restaurantId" TEXT NOT NULL,
 "mime" TEXT NOT NULL,
 "data" BYTEA NOT NULL,
 "sha256" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "RestaurantLogo_pkey" PRIMARY KEY ("restaurantId"),
 CONSTRAINT "RestaurantLogo_mime_valid" CHECK ("mime" IN ('image/jpeg','image/png','image/webp')),
 CONSTRAINT "RestaurantLogo_size" CHECK (octet_length("data") BETWEEN 1024 AND 3145728)
);
ALTER TABLE "RestaurantLogo" ADD CONSTRAINT "RestaurantLogo_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
