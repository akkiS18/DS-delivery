-- Dish photos (owner request 2026-10-27): the restaurant picks a photo in its app, the app shrinks it, the server stores it here.
-- Additive only: a new table, nothing existing changes. The bytes live in the database so the normal backup covers them (like RestaurantImage).
-- One photo per dish; replacing it bumps "version" (the customer apps put ?v=<version> on the URL so a new photo shows at once).
CREATE TABLE "ProductImage" (
 "productId" TEXT NOT NULL,
 "mime" TEXT NOT NULL,
 "data" BYTEA NOT NULL,
 "sha256" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("productId"),
 CONSTRAINT "ProductImage_mime_valid" CHECK ("mime" IN ('image/jpeg','image/png','image/webp')),
 CONSTRAINT "ProductImage_size" CHECK (octet_length("data") BETWEEN 1024 AND 4194304)
);
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
