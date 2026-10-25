import { isPaymentCleared } from '../payment/status.js';

export const PREP_CHOICES = [10, 15, 20, 30, 45, 60] as const;
/** Same range as Restaurant.defaultPrepMinutes. PREP_CHOICES are only the legacy Telegram quick buttons. */
export const isValidPrepMinutes = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 5 && n <= 120;
export type StaffAction = 'VERIFY_PAYMENT' | 'START_PREPARING' | 'MARK_READY';
export type WorkflowStatus = 'PAYMENT_MATCHED_UNVERIFIED' | 'PAYMENT_CONFIRMED' | 'PREPARING' | 'READY';

export type StaffPlan = { from: WorkflowStatus; to: WorkflowStatus; action: StaffAction };

/** Pure guard. No UI or Telegram can bypass this order/payment state transition. */
export function planStaffTransition(
  status: string,
  paymentStatus: string | null,
  action: StaffAction,
  minutes?: number,
): StaffPlan {
  if (action === 'VERIFY_PAYMENT') {
    if (status !== 'PAYMENT_MATCHED_UNVERIFIED' || paymentStatus !== 'MATCHED_UNVERIFIED') {
      throw new Error('TOLOV_MOS_EMAS_YOKI_AVVAL_TASDIQLANGAN');
    }
    return { from: 'PAYMENT_MATCHED_UNVERIFIED', to: 'PAYMENT_CONFIRMED', action };
  }
  if (action === 'START_PREPARING') {
    if (status !== 'PAYMENT_CONFIRMED' || !isPaymentCleared(paymentStatus)) {
      throw new Error('TAYYORLASH_UCHUN_TOLOV_TASDIGI_KERAK');
    }
    if (!isValidPrepMinutes(minutes)) throw new Error('TAYYORLASH_VAQTI_NOTOGRI');
    return { from: 'PAYMENT_CONFIRMED', to: 'PREPARING', action };
  }
  if (action === 'MARK_READY') {
    if (status !== 'PREPARING' || !isPaymentCleared(paymentStatus)) {
      throw new Error('BUYURTMA_TAYYORLASHDA_EMAS');
    }
    return { from: 'PREPARING', to: 'READY', action };
  }
  throw new Error('NOTANISH_AMAL');
}
