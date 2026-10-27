-- Category photos (owner request 2026-10-27): the customer menu opens on a grid of categories, each with the restaurant's own photo.
-- Additive only: a new table, nothing existing changes. Same shape and limits as "ProductImage" (bytes in the database so the normal backup covers them).
CREATE TABLE "CategoryImage" (
 "categoryId" TEXT NOT NULL,
 "mime" TEXT NOT NULL,
 "data" BYTEA NOT NULL,
 "sha256" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "CategoryImage_pkey" PRIMARY KEY ("categoryId"),
 CONSTRAINT "CategoryImage_mime_valid" CHECK ("mime" IN ('image/jpeg','image/png','image/webp')),
 CONSTRAINT "CategoryImage_size" CHECK (octet_length("data") BETWEEN 1024 AND 4194304)
);
ALTER TABLE "CategoryImage" ADD CONSTRAINT "CategoryImage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
