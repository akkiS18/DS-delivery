-- Finance PIN (owner decision 2026-11-05): the restaurant's money screens (Moliya) sit behind a 4-digit code so cashiers sharing the login cannot open them.
-- The administrator issues the code (shown once, only the Argon2id hash is stored). Additive only: one new table and one nullable column.
CREATE TABLE "RestaurantFinancePin" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "setBy" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RestaurantFinancePin_pkey" PRIMARY KEY ("id")
);

-- One code per restaurant (re-issuing replaces it).
CREATE UNIQUE INDEX "RestaurantFinancePin_restaurantId_key" ON "RestaurantFinancePin"("restaurantId");
ALTER TABLE "RestaurantFinancePin" ADD CONSTRAINT "RestaurantFinancePin_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantFinancePin" ADD CONSTRAINT "RestaurantFinancePin_attempts_nonneg" CHECK ("failedAttempts" >= 0);

-- The device session that entered the code stays open for a short, sliding window (null = locked).
ALTER TABLE "RestaurantSession" ADD COLUMN "financeUnlockedUntil" TIMESTAMPTZ(3);
