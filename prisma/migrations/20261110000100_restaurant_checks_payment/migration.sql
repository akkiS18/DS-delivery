-- "Shirin" mode (owner decision 2026-11-04): some restaurants neither give us a bank signal (Gmail / Humocard Telegram) nor let us watch their card, and want to
-- check by themselves that the money arrived. For them the customer is shown the restaurant's own card with no countdown, the order goes to the restaurant
-- at once, and the restaurant's "To'lovni tasdiqlash" tap IS the money check (the restaurant sees its own bank balance; we cannot).
--
-- Additive. Existing rows, statuses and constraints keep their meaning:
--   Restaurant.manualPaymentCheck  off by default; an administrator switches it on per restaurant (/manualpay)
--   Payment.method 'CARD_MANUAL'   payment status RESTAURANT_CHECK (waiting for the restaurant) -> CONFIRMED_MANUAL (the restaurant confirmed) | CANCELLED | EXPIRED
ALTER TABLE "Restaurant" ADD COLUMN "manualPaymentCheck" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_method_valid";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_method_valid" CHECK ("method" IN ('CARD', 'CASH', 'CARD_MANUAL'));

-- A real CONFIRMED_MANUAL payment used to need the bank signal it was matched to. A CARD_MANUAL payment has no signal by design: the restaurant's own
-- check replaces it. (Same NOT VALID rule as before: enforced for every new write, old rows untouched.)
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_real_match_needs_transaction";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_real_match_needs_transaction" CHECK (
 "isTest" OR "method" = 'CARD_MANUAL' OR "status" NOT IN ('MATCHED_UNVERIFIED','CONFIRMED_MANUAL') OR "matchedTransactionId" IS NOT NULL) NOT VALID;

-- ...and the other way round: a restaurant-checked payment is never linked to a bank signal, so the automatic confirmations (which only act on signals)
-- can never touch it.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_manual_has_no_signal" CHECK ("method" <> 'CARD_MANUAL' OR "matchedTransactionId" IS NULL);
