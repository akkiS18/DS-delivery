-- Owner requests 2026-11-01: packaging sold with a dish ("soboy idishi"), a 1+1 promotion, and a home-screen banner carousel.
-- Additive only: every new column has a default or is nullable, nothing existing is rewritten.

ALTER TABLE "Product" ADD COLUMN "packagingProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "isPackaging" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingProductId_fkey" FOREIGN KEY ("packagingProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A dish cannot be its own packaging.
ALTER TABLE "Product" ADD CONSTRAINT "Product_packaging_not_self" CHECK ("packagingProductId" IS NULL OR "packagingProductId" <> "id");

ALTER TABLE "Order" ADD COLUMN "promoDiscountSom" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD CONSTRAINT "Order_promo_discount_sane" CHECK ("promoDiscountSom" >= 0);

CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'BUY1_GET1',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "maxFreePerOrder" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Promotion_kind_known" CHECK ("kind" IN ('BUY1_GET1')),
  CONSTRAINT "Promotion_cap_sane" CHECK ("maxFreePerOrder" IS NULL OR "maxFreePerOrder" >= 1)
);
CREATE INDEX "Promotion_restaurantId_isActive_idx" ON "Promotion"("restaurantId", "isActive");
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PromotionProduct" (
  "promotionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("promotionId", "productId")
);
CREATE INDEX "PromotionProduct_productId_idx" ON "PromotionProduct"("productId");
ALTER TABLE "PromotionProduct" ADD CONSTRAINT "PromotionProduct_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionProduct" ADD CONSTRAINT "PromotionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Banner" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMPTZ(3),
  "endsAt" TIMESTAMPTZ(3),
  "restaurantId" TEXT,
  "promotionId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Banner_isActive_position_idx" ON "Banner"("isActive", "position");
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BannerImage" (
  "bannerId" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "sha256" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BannerImage_pkey" PRIMARY KEY ("bannerId")
);
ALTER TABLE "BannerImage" ADD CONSTRAINT "BannerImage_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
