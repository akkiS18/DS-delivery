-- Stage 8C: append-only audit of administrator actions that are not already recorded elsewhere (restaurant suspend/resume).
-- Additive. Same append-only rule as the commission ledger (ledger_append_only is defined in 20261024000100_commission_ledger).
CREATE TABLE "AdminAuditEvent" (
  "id"         TEXT NOT NULL,
  "actorId"    TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId"   TEXT NOT NULL,
  "details"    JSONB,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAuditEvent_targetType_targetId_createdAt_idx" ON "AdminAuditEvent" ("targetType", "targetId", "createdAt");
CREATE TRIGGER "AdminAuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AdminAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();
