-- Taxi operators work in an Android app (additive). One shared login per company, like the restaurant app.
-- passwordHash is an Argon2id PHC string and is never returned by any API; only a SHA-256 of a session token is stored.
CREATE TABLE "TaxiCredential" (
    "id" TEXT NOT NULL,
    "taxiCompanyId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordVersion" INTEGER NOT NULL DEFAULT 1,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxiCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxiCredential_taxiCompanyId_key" ON "TaxiCredential"("taxiCompanyId");
CREATE UNIQUE INDEX "TaxiCredential_login_key" ON "TaxiCredential"("login");
ALTER TABLE "TaxiCredential" ADD CONSTRAINT "TaxiCredential_taxiCompanyId_fkey" FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaxiSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "taxiCompanyId" TEXT NOT NULL,
    "passwordVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TaxiSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxiSession_tokenHash_key" ON "TaxiSession"("tokenHash");
CREATE INDEX "TaxiSession_taxiCompanyId_revokedAt_expiresAt_idx" ON "TaxiSession"("taxiCompanyId", "revokedAt", "expiresAt");
ALTER TABLE "TaxiSession" ADD CONSTRAINT "TaxiSession_taxiCompanyId_fkey" FOREIGN KEY ("taxiCompanyId") REFERENCES "TaxiCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
