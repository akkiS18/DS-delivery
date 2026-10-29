-- Admin app sign-in (additive: three new tables, nothing existing is touched).
CREATE TABLE "AdminLoginCode" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AdminLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuthAttempt" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuthAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminLoginCode_telegramUserId_createdAt_idx" ON "AdminLoginCode"("telegramUserId", "createdAt");
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_telegramUserId_revokedAt_expiresAt_idx" ON "AdminSession"("telegramUserId", "revokedAt", "expiresAt");
CREATE INDEX "AdminAuthAttempt_keyHash_kind_createdAt_idx" ON "AdminAuthAttempt"("keyHash", "kind", "createdAt");
CREATE INDEX "AdminAuthAttempt_createdAt_idx" ON "AdminAuthAttempt"("createdAt");
