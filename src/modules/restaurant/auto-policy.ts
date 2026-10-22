/**
 * Stage 8D: automatic confirmation of a REAL payment that the bank e-mail matched.
 *
 * Owner decision (2026-10-23): nobody should have to approve money that already arrived, and a customer must not wait for a person.
 * The Gmail match is still only a signal in the payment engine (it ends in MATCHED_UNVERIFIED); this actor confirms it right after, and only
 * when every check the manual VERIFY_PAYMENT applies also holds (exact amount, one linked trusted GMAIL transaction, no open refund).
 * Anything that is not an exact, unambiguous match never reaches this actor: the engine sends it to REVIEW_REQUIRED for an administrator.
 *
 * Kill switch: GMAIL_AUTO_CONFIRM=false returns to "the restaurant confirms in the app" without a code change.
 * No imports on purpose: restaurant/service.ts and restaurant-orders/auto.ts both depend on this file.
 */
export const GMAIL_AUTO_ACTOR = 'gmail-auto';

export const gmailAutoConfirmEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.GMAIL_AUTO_CONFIRM ?? '').trim().toLowerCase() !== 'false';
