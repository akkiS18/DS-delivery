-- Admin app "Diqqat" acknowledgements (additive: one new table).
CREATE TABLE "AdminAttentionAck" (
    "key" TEXT NOT NULL,
    "ackedBy" TEXT NOT NULL,
    "ackedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozeUntil" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminAttentionAck_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AdminAttentionAck_snoozeUntil_idx" ON "AdminAttentionAck"("snoozeUntil");
