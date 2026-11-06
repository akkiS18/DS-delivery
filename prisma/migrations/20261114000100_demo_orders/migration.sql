-- Admin test order ("/demo" in the admin bot): a fake order that shows a restaurant what a new order looks like. Additive only: one NOT NULL column with a
-- constant default (no table rewrite, no data change). Every existing order keeps isDemo = false.
ALTER TABLE "Order" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
-- The sweep that deletes expired demo orders looks them up by this flag; only demo rows are in the index.
CREATE INDEX "Order_isDemo_idx" ON "Order"("createdAt") WHERE "isDemo";

-- Admin test request for the taxi operator's app. A separate table on purpose: it is not a TaxiDispatch, so no worker, restaurant, customer, commission
-- or admin alert can ever see it. One row per company (unique), removed with the company.
CREATE TABLE "TaxiDemoRequest" (
    "id" TEXT NOT NULL,
    "taxiCompanyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TaxiDispatchStatus" NOT NULL DEFAULT 'REQUESTED',
    "cash" BOOLEAN NOT NULL DEFAULT false,
    "totalSom" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TaxiDemoRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxiDemoRequest_taxiCompanyId_key" ON "TaxiDemoRequest"("taxiCompanyId");
ALTER TABLE "TaxiDemoRequest" ADD CONSTRAINT "TaxiDemoRequest_taxiCompanyId_fkey" FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
