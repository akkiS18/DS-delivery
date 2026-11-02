import { t, T } from '../i18n';
import type { CustomerStage, OrderView } from './types';

/**
 * Server-clock countdown. The backend sends `serverNow` and `estimatedReadyAt`; the phone contributes only the elapsed time since the
 * response arrived (performance.now is monotonic), never its wall clock. A wrong phone time or time zone changes nothing.
 */
export interface Anchor { serverNowMs: number; receivedAtPerf: number }
export const anchorOf = (serverNowIso: string, perfNow: number): Anchor => ({ serverNowMs: Date.parse(serverNowIso), receivedAtPerf: perfNow });
export const serverTime = (a: Anchor, perfNow: number): number => a.serverNowMs + (perfNow - a.receivedAtPerf);

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

/** Shown through t(STAGE_LABEL[stage]). */
export const STAGE_LABEL: Record<CustomerStage, string> = {
  PAYMENT_PENDING: T('To‘lov kutilmoqda'),
  PAYMENT_CHECKING: T('To‘lov tekshirilmoqda'),
  PREPARING: T('Tayyorlanmoqda'),
  READY: T('Taom tayyor'),
  SELF_DELIVERY: T('Restoran olib bormoqda'),
  TAXI_REQUESTED: T('Taksi so‘ralgan'),
  TAXI_ACCEPTED: T('Taksi operatori qabul qildi'),
  TAXI_SENT: T('Taksi yo‘lga chiqdi'),
  DELIVERED: T('Yetkazildi'),
  CANCELLATION_REQUESTED: T('Bekor qilish so‘rovi yuborildi'),
  CANCELLED: T('Bekor qilingan'),
  EXPIRED: T('Muddati tugagan'),
  NEEDS_HELP: T('Yordam kerak'),
};

export const isTerminal = (s: CustomerStage): boolean => s === 'DELIVERED' || s === 'CANCELLED' || s === 'EXPIRED';
const PAID_STAGES: CustomerStage[] = ['PREPARING', 'READY', 'SELF_DELIVERY', 'TAXI_REQUESTED', 'TAXI_ACCEPTED', 'TAXI_SENT', 'DELIVERED'];
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

const ORDER: CustomerStage[] = ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING', 'READY', 'SELF_DELIVERY', 'TAXI_REQUESTED', 'TAXI_ACCEPTED', 'TAXI_SENT', 'DELIVERED'];

/**
 * The tracking timeline, built only from the real stage. "Taxi accepted" and "Taxi sent" are separate steps (an accepted booking is
 * not a dispatched taxi), and nothing is shown as delivered before the operator-confirmed DELIVERED.
 */
export function timeline(o: Pick<OrderView, 'stage'> & { deliveryMode?: 'TAXI' | 'SELF' }): Step[] {
  const stage = o.stage;
  if (stage === 'CANCELLED' || stage === 'EXPIRED') {
    return [{ key: 'placed', label: t('Buyurtma berildi'), state: 'done' }, { key: 'end', label: t(STAGE_LABEL[stage]), state: 'bad' }];
  }
  if (stage === 'CANCELLATION_REQUESTED') {
    return [{ key: 'placed', label: t('Buyurtma berildi'), state: 'done' }, { key: 'end', label: t(STAGE_LABEL[stage]), state: 'current', note: t('Pulni qaytarish restoran qaroriga bog‘liq.') }];
  }
  const at = stage === 'NEEDS_HELP' ? ORDER.indexOf('TAXI_REQUESTED') : ORDER.indexOf(stage);
  const step = (key: CustomerStage, label: string): Step => {
    const i = ORDER.indexOf(key);
    const state: StepState = at > i || stage === 'DELIVERED' ? 'done' : at === i ? 'current' : 'todo';
    return { key, label, state };
  };
  const steps: Step[] = [
    { key: 'placed', label: t('Buyurtma berildi'), state: 'done' },
    step('PAYMENT_PENDING', t('To‘lov')),
    step('PAYMENT_CHECKING', t('To‘lov tasdiqlanishi')),
    step('PREPARING', t('Tayyorlanmoqda')),
    step('READY', t('Taom tayyor')),
    ...(o.deliveryMode === 'SELF' || stage === 'SELF_DELIVERY'
      ? [step('SELF_DELIVERY', t('Restoran olib bormoqda'))]
      : [step('TAXI_REQUESTED', t('Taksi so‘raldi')), step('TAXI_ACCEPTED', t('Operator qabul qildi')), step('TAXI_SENT', t('Taksi yo‘lda'))]),
    step('DELIVERED', t('Yetkazildi')),
  ];
  if (stage === 'NEEDS_HELP') {
    const i = steps.findIndex(s => s.key === 'TAXI_REQUESTED');
    steps[i] = { ...steps[i]!, state: 'bad', note: t('Taksi topishda yordam kerak. Biz hal qilamiz; buyurtma bekor bo‘lmaydi.') };
    for (let j = i + 1; j < steps.length; j++) steps[j] = { ...steps[j]!, state: 'todo' };
  }
  return steps;
}

/**
 * The three things a customer follows, in order: payment, cooking, delivery. Each step turns into a check mark when its job is done by a real
 * person: the payment is accepted, the restaurant presses "ready", the taxi operator presses "delivered". Booking a taxi and the operator
 * accepting it are not shown; they are part of "Yetkazilmoqda". Failed/cancelled orders have no steps (null).
 */
export type HeroKey = 'PAY' | 'COOK' | 'ROAD';
export interface HeroStep { key: HeroKey; label: string; state: 'done' | 'current' | 'todo' }

/** How many of the three steps are finished at each stage (3 = all done). */
const HERO_DONE: Partial<Record<CustomerStage, number>> = {
  PAYMENT_PENDING: 0, PAYMENT_CHECKING: 0,
  PREPARING: 1,
  READY: 2, SELF_DELIVERY: 2, TAXI_REQUESTED: 2, TAXI_ACCEPTED: 2, TAXI_SENT: 2,
  DELIVERED: 3,
};

export function heroSteps(stage: CustomerStage): HeroStep[] | null {
  const done = HERO_DONE[stage];
  if (done === undefined) return null;
  const state = (i: number): HeroStep['state'] => (i < done ? 'done' : i === done ? 'current' : 'todo');
  return [
    { key: 'PAY', label: t('To‘lov'), state: state(0) },
    { key: 'COOK', label: done > 1 ? t('Tayyor') : t('Tayyorlanmoqda'), state: state(1) },
    { key: 'ROAD', label: done > 2 ? t('Yetkazildi') : t('Yetkazilmoqda'), state: state(2) },
  ];
}
