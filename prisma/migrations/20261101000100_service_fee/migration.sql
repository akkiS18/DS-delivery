-- Service fee baked into dish prices (owner decision 2026-10-25). Additive: nullable columns, no backfill; legacy orders stay NULL (flat commission).
ALTER TABLE "Order" ADD COLUMN "baseTotalSom" INTEGER;
ALTER TABLE "Order" ADD COLUMN "serviceFeeSom" INTEGER;
ALTER TABLE "Order" ADD COLUMN "feeRuleCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "baseUnitSom" INTEGER;

-- A fee order always carries its base and adds up exactly. Legacy rows (all NULL) satisfy this.
ALTER TABLE "Order" ADD CONSTRAINT "Order_service_fee_consistent" CHECK (
  "serviceFeeSom" IS NULL
  OR ("baseTotalSom" IS NOT NULL AND "feeRuleCode" IS NOT NULL AND "serviceFeeSom" >= 0 AND "totalSom" = "baseTotalSom" + "serviceFeeSom")
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_base_unit_sane" CHECK ("baseUnitSom" IS NULL OR ("baseUnitSom" >= 0 AND "baseUnitSom" <= "unitSom"));
