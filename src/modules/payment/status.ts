/** Pure payment-status vocabulary shared by the workflow guards, commission rules and the taxi gates (no I/O: safe to import anywhere). */
export const CASH_PENDING = 'CASH_PENDING';
export const CASH_ACCEPTED = 'CASH_ACCEPTED';

/** "The money question is settled enough to cook and deliver": a restaurant-verified card payment, or a cash order the restaurant accepted. */
export const isPaymentCleared = (status: string | null | undefined): boolean => status === 'CONFIRMED_MANUAL' || status === CASH_ACCEPTED;
export const PAYMENT_CLEARED_STATUSES = ['CONFIRMED_MANUAL', CASH_ACCEPTED] as const;
