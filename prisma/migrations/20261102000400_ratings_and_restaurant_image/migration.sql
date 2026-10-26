-- Restaurant ratings (one per delivered order, set by the customer) and the restaurant's own photo. Additive.
CREATE TABLE "OrderRating" (
 "id" TEXT NOT NULL,
 "orderId" TEXT NOT NULL,
 "restaurantId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL,
 "stars" INTEGER NOT NULL,
 "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "note" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "OrderRating_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OrderRating_stars_range" CHECK ("stars" BETWEEN 1 AND 5),
 CONSTRAINT "OrderRating_note_len" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200),
 CONSTRAINT "OrderRating_reasons_count" CHECK (cardinality("reasons") <= 6)
);
CREATE UNIQUE INDEX "OrderRating_orderId_key" ON "OrderRating"("orderId");
CREATE INDEX "OrderRating_restaurantId_createdAt_idx" ON "OrderRating"("restaurantId","createdAt");
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The photo is stored in the database (small, already compressed by Telegram) so it is covered by the normal database backup.
CREATE TABLE "RestaurantImage" (
 "restaurantId" TEXT NOT NULL,
 "mime" TEXT NOT NULL,
 "data" BYTEA NOT NULL,
 "sha256" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "RestaurantImage_pkey" PRIMARY KEY ("restaurantId"),
 CONSTRAINT "RestaurantImage_mime_valid" CHECK ("mime" IN ('image/jpeg','image/png','image/webp')),
 CONSTRAINT "RestaurantImage_size" CHECK (octet_length("data") BETWEEN 1024 AND 3145728)
);
ALTER TABLE "RestaurantImage" ADD CONSTRAINT "RestaurantImage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
