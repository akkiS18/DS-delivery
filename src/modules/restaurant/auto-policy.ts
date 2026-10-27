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

/**
 * Owner decision 2026-10-27: a Humocard Telegram message from the verified bot account is confirmed the same way (its own actor, so the audit
 * trail says which signal was relied on). Kill switch: HUMO_AUTO_CONFIRM=false. Each actor may rely ONLY on its own signal source: the
 * e-mail actor never confirms a Telegram match and vice versa (checked in takeStaffAction).
 */
export const HUMO_AUTO_ACTOR = 'humo-auto';
export const humoAutoConfirmEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.HUMO_AUTO_CONFIRM ?? '').trim().toLowerCase() !== 'false';

export type AutoSource = 'GMAIL' | 'HUMO_TG';
/** The IncomingTransaction.source an automatic actor relies on (null: not an automatic bank-signal actor). */
export const autoSourceOfActor = (actor: string | undefined): AutoSource | null =>
  actor === GMAIL_AUTO_ACTOR ? 'GMAIL' : actor === HUMO_AUTO_ACTOR ? 'HUMO_TG' : null;
export const autoActorOfSource = (source: string): string | null =>
  source === 'GMAIL' ? GMAIL_AUTO_ACTOR : source === 'HUMO_TG' ? HUMO_AUTO_ACTOR : null;
export const autoConfirmEnabledForSource = (source: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean =>
  source === 'GMAIL' ? gmailAutoConfirmEnabled(env) : source === 'HUMO_TG' ? humoAutoConfirmEnabled(env) : false;
