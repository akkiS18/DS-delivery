import type { CustomerStage, OrderView, PrepClock } from './types';

/**
 * Server-clock countdown. The backend sends `serverNow` and `estimatedReadyAt`; the phone contributes only the elapsed time since the
 * response arrived (performance.now is monotonic), never its wall clock. A wrong phone time or time zone changes nothing.
 */
export interface Anchor { serverNowMs: number; receivedAtPerf: number }
export const anchorOf = (serverNowIso: string, perfNow: number): Anchor => ({ serverNowMs: Date.parse(serverNowIso), receivedAtPerf: perfNow });
export const serverTime = (a: Anchor, perfNow: number): number => a.serverNowMs + (perfNow - a.receivedAtPerf);

/** Seconds left (>0), or <= 0 once the estimate is reached (negative = seconds late); null when there is no estimate. */
export function remainingSeconds(prep: PrepClock, a: Anchor, perfNow: number): number | null {
  if (!prep.estimatedReadyAt) return null;
  const ready = Date.parse(prep.estimatedReadyAt);
  if (Number.isNaN(ready) || Number.isNaN(a.serverNowMs)) return null;
  const diff = ready - serverTime(a, perfNow);
  return diff >= 0 ? Math.ceil(diff / 1000) : -Math.floor(-diff / 1000);
}
/** Seconds left to pay (>0), or <= 0 once the window is over; null when there is no deadline. Same server-clock rule as the cooking countdown. */
export function paymentRemainingSeconds(expiresAtIso: string | null | undefined, a: Anchor, perfNow: number): number | null {
  if (!expiresAtIso) return null;
  const end = Date.parse(expiresAtIso);
  if (Number.isNaN(end) || Number.isNaN(a.serverNowMs)) return null;
  const diff = end - serverTime(a, perfNow);
  return diff >= 0 ? Math.ceil(diff / 1000) : -Math.floor(-diff / 1000);
}
/** "10 daqiqa" for a 600 s window; 90 s reads "2 daqiqa" (rounded up, never promises more time than there is). */
export const windowMinutes = (windowSeconds: number | null | undefined, fallback = 10): number =>
  windowSeconds && windowSeconds > 0 ? Math.max(1, Math.ceil(windowSeconds / 60)) : fallback;

/** Minutes late, rounded up while any lateness exists (so the first second late already reads 1); 0 while time is left. */
export const overdueMinutes = (remaining: number): number => (remaining > 0 ? 0 : Math.max(1, Math.ceil(-remaining / 60)));

export const STAGE_LABEL: Record<CustomerStage, string> = {
  PAYMENT_PENDING: 'To‘lov kutilmoqda',
  PAYMENT_CHECKING: 'To‘lov tekshirilmoqda',
  PREPARING: 'Tayyorlanmoqda',
  READY: 'Taom tayyor',
  TAXI_REQUESTED: 'Taksi so‘ralgan',
  TAXI_ACCEPTED: 'Taksi operatori qabul qildi',
  TAXI_SENT: 'Taksi yo‘lga chiqdi',
  DELIVERED: 'Yetkazildi',
  CANCELLATION_REQUESTED: 'Bekor qilish so‘rovi yuborildi',
  CANCELLED: 'Bekor qilingan',
  EXPIRED: 'Muddati tugagan',
  NEEDS_HELP: 'Yordam kerak',
};

export const isTerminal = (s: CustomerStage): boolean => s === 'DELIVERED' || s === 'CANCELLED' || s === 'EXPIRED';
const PAID_STAGES: CustomerStage[] = ['PREPARING', 'READY', 'TAXI_REQUESTED', 'TAXI_ACCEPTED', 'TAXI_SENT', 'DELIVERED'];
const WAITING_FOR_PAYMENT: CustomerStage[] = ['PAYMENT_PENDING', 'PAYMENT_CHECKING'];
/** A payment that was accepted this recently still counts as "just now" when the screen is opened for the first time. */
const JUST_NOW_MS = 2 * 60_000;

/**
 * Should the "to'lovingiz qabul qilindi" notice be shown now? Once per order: when the screen sees the order move from waiting-for-payment to
 * paid, or when it is opened within two minutes of the acceptance (the customer was in another app while the money arrived).
 * `prev` is the stage this screen saw before (null = first load); `serverNowIso`/`paidAtIso` come from the server, so a wrong phone clock does not matter.
 */
export function shouldAnnouncePaid(prev: CustomerStage | null, next: CustomerStage, alreadySeen: boolean, paidAtIso?: string | null, serverNowIso?: string): boolean {
  if (alreadySeen || !PAID_STAGES.includes(next)) return false;
  if (prev !== null) return WAITING_FOR_PAYMENT.includes(prev);
  if (!paidAtIso || !serverNowIso) return false;
  const age = Date.parse(serverNowIso) - Date.parse(paidAtIso);
  return Number.isFinite(age) && age >= 0 && age <= JUST_NOW_MS;
}

/** Polling cadence: quicker while the payment is awaited, slower while cooking, none when finished. (Polling, not push.) */
export const pollIntervalMs = (s: CustomerStage): number | null => (isTerminal(s) ? null : s === 'PAYMENT_PENDING' ? 4000 : 8000);

export type StepState = 'done' | 'current' | 'todo' | 'bad';
export interface Step { key: string; label: string; state: StepState; note?: string }

const ORDER: CustomerStage[] = ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'TAXI_ACCEPTED', 'TAXI_SENT', 'DELIVERED'];

/**
 * The tracking timeline, built only from the real stage. "Taxi accepted" and "Taxi sent" are separate steps (an accepted booking is
 * not a dispatched taxi), and nothing is shown as delivered before the operator-confirmed DELIVERED.
 */
export function timeline(o: Pick<OrderView, 'stage'>): Step[] {
  const stage = o.stage;
  if (stage === 'CANCELLED' || stage === 'EXPIRED') {
    return [{ key: 'placed', label: 'Buyurtma berildi', state: 'done' }, { key: 'end', label: STAGE_LABEL[stage], state: 'bad' }];
  }
  if (stage === 'CANCELLATION_REQUESTED') {
    return [{ key: 'placed', label: 'Buyurtma berildi', state: 'done' }, { key: 'end', label: STAGE_LABEL[stage], state: 'current', note: 'Pulni qaytarish restoran qaroriga bog‘liq.' }];
  }
  const at = stage === 'NEEDS_HELP' ? ORDER.indexOf('TAXI_REQUESTED') : ORDER.indexOf(stage);
  const step = (key: CustomerStage, label: string): Step => {
    const i = ORDER.indexOf(key);
    const state: StepState = at > i || stage === 'DELIVERED' ? 'done' : at === i ? 'current' : 'todo';
    return { key, label, state };
  };
  const steps: Step[] = [
    { key: 'placed', label: 'Buyurtma berildi', state: 'done' },
    step('PAYMENT_PENDING', 'To‘lov'),
    step('PAYMENT_CHECKING', 'To‘lov tasdiqlanishi'),
    step('PREPARING', 'Tayyorlanmoqda'),
    step('READY', 'Taom tayyor'),
    step('TAXI_REQUESTED', 'Taksi so‘raldi'),
    step('TAXI_ACCEPTED', 'Operator qabul qildi'),
    step('TAXI_SENT', 'Taksi yo‘lda'),
    step('DELIVERED', 'Yetkazildi'),
  ];
  if (stage === 'NEEDS_HELP') {
    const i = steps.findIndex(s => s.key === 'TAXI_REQUESTED');
    steps[i] = { ...steps[i]!, state: 'bad', note: 'Taksi topishda yordam kerak. Biz hal qilamiz; buyurtma bekor bo‘lmaydi.' };
    for (let j = i + 1; j < steps.length; j++) steps[j] = { ...steps[j]!, state: 'todo' };
  }
  return steps;
}
