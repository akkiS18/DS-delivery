-- Stage 6A - cancellation and manual refund workflow. Additive: no existing row is changed or deleted.
-- DS Delivery holds no customer funds. This table records requests/decisions/attestations only; nothing here moves money.
ALTER TYPE "TaxiDispatchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TABLE "RefundRequest" (
 "id" TEXT NOT NULL,
 "number" SERIAL NOT NULL,
 "orderId" TEXT NOT NULL,
 "paymentId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'REQUESTED',
 "reasonCode" TEXT NOT NULL,
 "reasonNote" TEXT,
 "paidAmountTiyin" BIGINT NOT NULL,
 "approvedAmountTiyin" BIGINT,
 "orderStatusBefore" TEXT NOT NULL,
 "paymentStatusAtRequest" TEXT NOT NULL,
 "taxiActiveAtDecision" BOOLEAN NOT NULL DEFAULT false,
 "requestedBy" TEXT NOT NULL,
 "requestedByType" TEXT NOT NULL,
 "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "decidedBy" TEXT,
 "decidedAt" TIMESTAMPTZ(3),
 "rejectReason" TEXT,
 "sentBy" TEXT,
 "sentAt" TIMESTAMPTZ(3),
 "bankReference" TEXT,
 "confirmedBy" TEXT,
 "confirmedByType" TEXT,
 "confirmedAt" TIMESTAMPTZ(3),
 "confirmNote" TEXT,
 "disputedAt" TIMESTAMPTZ(3),
 "staffNotifiedAt" TIMESTAMPTZ(3),
 "adminNotifiedAt" TIMESTAMPTZ(3),
 "customerDecisionNotifiedAt" TIMESTAMPTZ(3),
 "customerSentNotifiedAt" TIMESTAMPTZ(3),
 "disputeNotifiedAt" TIMESTAMPTZ(3),
 CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RefundRequest_status_check" CHECK ("status" IN ('REQUESTED','APPROVED','REJECTED','SENT','CONFIRMED','DISPUTED')),
 CONSTRAINT "RefundRequest_kind_check" CHECK ("kind" IN ('CUSTOMER_CANCEL','RESTAURANT_CANCEL')),
 CONSTRAINT "RefundRequest_paid_positive" CHECK ("paidAmountTiyin" > 0),
 CONSTRAINT "RefundRequest_approved_range" CHECK ("approvedAmountTiyin" IS NULL OR ("approvedAmountTiyin" > 0 AND "approvedAmountTiyin" <= "paidAmountTiyin")),
 -- An approved/sent/confirmed/disputed request always has an approved amount.
 CONSTRAINT "RefundRequest_amount_when_approved" CHECK ("status" NOT IN ('APPROVED','SENT','CONFIRMED','DISPUTED') OR "approvedAmountTiyin" IS NOT NULL),
 -- The restaurant must record WHO sent it and a bank reference before the request can be SENT or CONFIRMED.
 CONSTRAINT "RefundRequest_sent_needs_reference" CHECK ("status" NOT IN ('SENT','CONFIRMED') OR ("bankReference" IS NOT NULL AND char_length("bankReference") >= 4 AND "sentBy" IS NOT NULL AND "sentAt" IS NOT NULL)),
 -- CONFIRMED needs an attestation from someone other than a single restaurant click: the customer or a DS admin.
 CONSTRAINT "RefundRequest_confirmed_needs_attestation" CHECK ("status" <> 'CONFIRMED' OR ("confirmedBy" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmedByType" IN ('CUSTOMER','ADMIN'))),
 CONSTRAINT "RefundRequest_admin_confirm_needs_note" CHECK ("confirmedByType" IS DISTINCT FROM 'ADMIN' OR ("confirmNote" IS NOT NULL AND char_length("confirmNote") >= 10)),
 CONSTRAINT "RefundRequest_rejected_needs_reason" CHECK ("status" <> 'REJECTED' OR "rejectReason" IS NOT NULL)
);
CREATE UNIQUE INDEX "RefundRequest_number_key" ON "RefundRequest"("number");
CREATE INDEX "RefundRequest_orderId_idx" ON "RefundRequest"("orderId");
CREATE INDEX "RefundRequest_status_requestedAt_idx" ON "RefundRequest"("status","requestedAt");
-- Duplicate prevention: one open request per order, and a payment can be refunded at most once (open or completed).
CREATE UNIQUE INDEX "RefundRequest_one_open_per_order" ON "RefundRequest"("orderId") WHERE "status" IN ('REQUESTED','APPROVED','SENT','DISPUTED');
CREATE UNIQUE INDEX "RefundRequest_one_per_payment" ON "RefundRequest"("paymentId") WHERE "status" IN ('REQUESTED','APPROVED','SENT','DISPUTED','CONFIRMED');
-- History is preserved: orders and payments that have a refund record cannot be deleted.
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RefundEvent" (
 "id" TEXT NOT NULL,
 "refundId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "actorType" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "fromStatus" TEXT,
 "toStatus" TEXT,
 "details" JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RefundEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefundEvent_refundId_createdAt_idx" ON "RefundEvent"("refundId","createdAt");
ALTER TABLE "RefundEvent" ADD CONSTRAINT "RefundEvent_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
