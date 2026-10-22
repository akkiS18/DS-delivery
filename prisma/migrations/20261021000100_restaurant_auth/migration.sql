-- Stage 5A - restaurant API authentication. Additive: three new tables, nothing existing is changed or seeded.
-- No credential rows are created here; they are provisioned explicitly with `npm run restaurant:password`.
CREATE TABLE "RestaurantCredential" (
 "id" TEXT NOT NULL,
 "restaurantId" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL,
 "passwordVersion" INTEGER NOT NULL DEFAULT 1,
 "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RestaurantCredential_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RestaurantCredential_hash_argon2id" CHECK ("passwordHash" LIKE '$argon2id$%')
);
CREATE UNIQUE INDEX "RestaurantCredential_restaurantId_key" ON "RestaurantCredential"("restaurantId");
ALTER TABLE "RestaurantCredential" ADD CONSTRAINT "RestaurantCredential_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantSession" (
 "id" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL,
 "restaurantId" TEXT NOT NULL,
 "passwordVersion" INTEGER NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "revokedAt" TIMESTAMPTZ(3),
 CONSTRAINT "RestaurantSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RestaurantSession_tokenHash_key" ON "RestaurantSession"("tokenHash");
CREATE INDEX "RestaurantSession_restaurantId_revokedAt_expiresAt_idx" ON "RestaurantSession"("restaurantId","revokedAt","expiresAt");
ALTER TABLE "RestaurantSession" ADD CONSTRAINT "RestaurantSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantLoginAttempt" (
 "id" TEXT NOT NULL,
 "keyHash" TEXT NOT NULL,
 "success" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RestaurantLoginAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RestaurantLoginAttempt_keyHash_createdAt_idx" ON "RestaurantLoginAttempt"("keyHash","createdAt");
CREATE INDEX "RestaurantLoginAttempt_createdAt_idx" ON "RestaurantLoginAttempt"("createdAt");
