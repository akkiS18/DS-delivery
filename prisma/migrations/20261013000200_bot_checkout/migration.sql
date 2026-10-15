-- DS Delivery bot checkout V0.3. Non-destructive migration.
CREATE TABLE "TaxiCompany" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TaxiCompany_name_key" ON "TaxiCompany"("name");
ALTER TABLE "Order" ADD COLUMN "checkoutKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "phoneSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN "taxiCompanyId" TEXT;
ALTER TABLE "Order" ADD COLUMN "createdViaBot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "allowTaxiFallback" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");
CREATE INDEX "Order_taxiCompanyId_idx" ON "Order"("taxiCompanyId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_taxiCompanyId_fkey" FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "botLastNotifiedStatus" TEXT;
