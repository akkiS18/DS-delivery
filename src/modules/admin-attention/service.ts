import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { gmailHealth } from '../payment/gmail-health.js';
import { cardTurnoverSom, poolCapSom, POOL_TURNOVER_DAYS } from '../payment/pool.js';
import { explainReason } from '../payment/review-reasons.js';
import { listUnhandledReviews } from '../payment/review.js';
import { CARD_MANUAL, CASH_PENDING, RESTAURANT_CHECK } from '../payment/status.js';
import { taxiStage } from '../taxi/workflow.js';

/**
 * "Diqqat": what the administrator has to look at right now. Everything is DERIVED from the current database state on every
 * call (nothing is stored but the "I called" acknowledgements), so an item disappears by itself the moment its cause is gone.
 * Order-related rules apply to REAL orders created through the apps/bot (createdViaBot) only.
 */
export type AttentionKind =
  | 'ORDER_UNSEEN' | 'CASH_UNACCEPTED' | 'PAYMENT_UNVERIFIED' | 'TAXI_NEEDS_HELP' | 'MONEY_REVIEW' | 'GMAIL_DOWN'
  | 'RESTAURANT_OFFLINE' | 'READY_NO_TAXI' | 'NOT_DELIVERED' | 'CARD_PENDING' | 'SUPPORT_TICKET' | 'CARD_TURN_MID' | 'CARD_TURN_HIGH' | 'REFUND_DISPUTED' | 'REFUND_POOL_DUE';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

const SEVERITY: Record<AttentionKind, Severity> = {
  ORDER_UNSEEN: 'CRITICAL', CASH_UNACCEPTED: 'CRITICAL', PAYMENT_UNVERIFIED: 'CRITICAL', TAXI_NEEDS_HELP: 'CRITICAL', MONEY_REVIEW: 'CRITICAL', GMAIL_DOWN: 'CRITICAL',
  RESTAURANT_OFFLINE: 'HIGH', READY_NO_TAXI: 'HIGH',
  NOT_DELIVERED: 'MEDIUM', CARD_PENDING: 'MEDIUM', SUPPORT_TICKET: 'MEDIUM',
  CARD_TURN_MID: 'MEDIUM', CARD_TURN_HIGH: 'HIGH', REFUND_DISPUTED: 'HIGH', REFUND_POOL_DUE: 'HIGH',
};
/** Listed but never rung and never announced: a heads-up, not something to wake anybody for. */
const SILENT_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>(['CARD_TURN_MID']);
/**
 * Owner decision 2026-10-30: only what MUST be solved on the spot rings (somebody is waiting right now: a paid order nobody saw, cash nobody accepted,
 * a payment nobody confirmed, a taxi in trouble, a ready order without a taxi, a restaurant app that went dark with orders waiting, and Gmail down
 * because then no card payment is recognised). Everything else (suspicious money, disputes, tickets, cards, late deliveries) is a one-time ordinary
 * notification: it stays in the list, it never rings, so the administrator does not have to watch the app all day.
 */
const RING_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>([
  'ORDER_UNSEEN', 'CASH_UNACCEPTED', 'PAYMENT_UNVERIFIED', 'TAXI_NEEDS_HELP', 'GMAIL_DOWN', 'RESTAURANT_OFFLINE', 'READY_NO_TAXI',
]);
const RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };

/** Kinds the Telegram copy announces: the others already reach the administrator through their own Telegram alerts. */
export const TELEGRAM_COPY_KINDS: readonly AttentionKind[] = ['ORDER_UNSEEN', 'CASH_UNACCEPTED', 'PAYMENT_UNVERIFIED', 'RESTAURANT_OFFLINE', 'READY_NO_TAXI', 'NOT_DELIVERED'];

export interface RawItem {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  restaurant: { id: string; name: string; phone: string | null } | null;
  orderCode: string | null;
  since: Date | null;
}
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  severity: Severity;
  title: string;
  detail: string;
  restaurant: { id: string; name: string; phone: string | null } | null;
  orderCode: string | null;
  since: string | null;
  ageSeconds: number | null;
  /** The administrator said "called": quiet until snoozeUntil. */
  acked: boolean;
  snoozeUntil: string | null;
  /** The app rings for this item (a RING kind, not acked, and not a quiet-hours item below CRITICAL). */
  alarm: boolean;
  /** The app shows an ordinary one-time notification for this item (not a RING kind, not acked, not a silent kind). */
  notify: boolean;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} ${min}–${max} oralig‘ida bo‘lsin`);
  return n;
}
/** Seconds an item must have been open before it is raised. Read per call so tests (and operators after a restart) can change them. */
export function attentionConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    unseenSeconds: intEnv(env, 'ADMIN_ATTN_UNSEEN_SECONDS', 120, 10, 3600),
    cashSeconds: intEnv(env, 'ADMIN_ATTN_CASH_SECONDS', 180, 10, 3600),
    offlineSeconds: intEnv(env, 'ADMIN_ATTN_OFFLINE_SECONDS', 180, 120, 3600), // the session heartbeat is written at most every 60 s
    unverifiedSeconds: intEnv(env, 'ADMIN_ATTN_UNVERIFIED_SECONDS', 180, 10, 3600),
    readyNoTaxiSeconds: intEnv(env, 'ADMIN_ATTN_READY_NO_TAXI_SECONDS', 300, 30, 7200),
    notDeliveredSeconds: intEnv(env, 'ADMIN_ATTN_NOT_DELIVERED_SECONDS', 3600, 300, 86_400),
    ticketSeconds: intEnv(env, 'ADMIN_ATTN_TICKET_SECONDS', 600, 30, 86_400),
    snoozeMinutes: intEnv(env, 'ADMIN_ATTN_SNOOZE_MINUTES', 15, 1, 720),
    lookbackHours: intEnv(env, 'ADMIN_ATTN_LOOKBACK_HOURS', 72, 1, 720),
  };
}
export type AttentionConfig = ReturnType<typeof attentionConfig>;

// ---- quiet hours (Asia/Tashkent has no daylight saving: UTC+5) ----
export const QUIET_KEY = 'admin_quiet_hours';
export type QuietHours = { from: string; to: string } | null;
export const DEFAULT_QUIET: { from: string; to: string } = { from: '01:00', to: '07:00' };
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Stored value -> window. No row = the default window, "off" = no quiet hours, anything unreadable = the default (never silently "off"). */
export function parseQuiet(value: string | null | undefined): QuietHours {
  if (value === undefined || value === null) return DEFAULT_QUIET;
  if (value === 'off') return null;
  const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(value);
  if (!m || !HHMM.test(m[1]!) || !HHMM.test(m[2]!)) return DEFAULT_QUIET;
  return { from: m[1]!, to: m[2]! };
}
export const formatQuiet = (q: QuietHours): string => (q ? `${q.from}-${q.to}` : 'off');
export const isHHMM = (v: string): boolean => HHMM.test(v);
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export const tashkentMinutes = (now: Date): number => (now.getUTCHours() * 60 + now.getUTCMinutes() + 300) % 1440;
/** Window may wrap midnight (01:00-07:00 or 23:00-06:00). from == to is an empty window. */
export function inQuietHours(q: QuietHours, now: Date): boolean {
  if (!q) return false;
  const a = minutesOf(q.from); const b = minutesOf(q.to); const t = tashkentMinutes(now);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

// ---- rules over active orders (pure) ----
export const orderSelect = {
  id: true, code: true, status: true, totalSom: true, createdAt: true, updatedAt: true, deliveryMode: true, readyAt: true,
  preparingStartedAt: true, paymentVerifiedAt: true, prepChosenMinutes: true,
  restaurant: { select: { id: true, name: true, pickupPhone: true } },
  payment: { select: { method: true, status: true, matchedAt: true } },
  taxiDispatches: { orderBy: { attemptNo: 'desc' }, take: 1, select: { status: true, dispatchedAt: true, updatedAt: true, taxiCompany: { select: { name: true } } } },
} satisfies Prisma.OrderSelect;
export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/** Orders that may need attention: everything the restaurant or the taxi still has to move, plus cash orders nobody accepted yet. */
export function activeOrdersWhere(now: Date, cfg: AttentionConfig): Prisma.OrderWhereInput {
  return {
    createdViaBot: true, paymentIsTest: false, createdAt: { gte: new Date(now.getTime() - cfg.lookbackHours * 3_600_000) },
    OR: [
      { status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } },
      { status: 'PAYMENT_PENDING', payment: { is: { method: 'CASH', status: CASH_PENDING } } },
      { status: 'PAYMENT_PENDING', payment: { is: { method: CARD_MANUAL, status: RESTAURANT_CHECK } } }, // "Shirin": the restaurant has to confirm the money
    ],
  };
}

const ageSec = (since: Date | null | undefined, now: Date): number => (since ? Math.floor((now.getTime() - since.getTime()) / 1000) : 0);
const minutes = (sec: number): number => Math.max(1, Math.round(sec / 60));
const somText = (n: number): string => n.toLocaleString('en-US').replace(/,/g, ' ');
const ref = (r: OrderRow['restaurant']) => ({ id: r.id, name: r.name, phone: r.pickupPhone });

/** One restaurant is waiting for something the restaurant must do NOW (used by the "app offline" rule). */
function restaurantWaitingSince(o: OrderRow): Date | null {
  const method = o.payment?.method;
  if (o.status === 'PAYMENT_PENDING' && (method === 'CASH' || method === CARD_MANUAL)) return o.createdAt;
  if (o.status === 'PAYMENT_MATCHED_UNVERIFIED') return o.payment?.matchedAt ?? o.updatedAt;
  if (o.status === 'PAYMENT_CONFIRMED') return o.paymentVerifiedAt ?? o.updatedAt;
  if (o.status === 'PREPARING' && o.prepChosenMinutes === null) return o.preparingStartedAt ?? o.paymentVerifiedAt ?? o.updatedAt;
  return null;
}

/** `online` = restaurants with a signed-in app that reported in recently. Pure: no database access. */
export function evaluateOrders(rows: OrderRow[], online: ReadonlySet<string>, now: Date, cfg: AttentionConfig): RawItem[] {
  const out: RawItem[] = [];
  const waiting = new Map<string, { since: Date; count: number; restaurant: OrderRow['restaurant'] }>();
  for (const o of rows) {
    const r = ref(o.restaurant);
    const method = o.payment?.method;
    const pstatus = o.payment?.status;
    const base = { restaurant: r, orderCode: o.code };

    if (o.status === 'PAYMENT_PENDING' && method === 'CASH' && pstatus === CASH_PENDING) {
      if (ageSec(o.createdAt, now) >= cfg.cashSeconds) {
        out.push({ ...base, key: `CASH_UNACCEPTED:${o.id}`, kind: 'CASH_UNACCEPTED', title: 'Naqd buyurtma qabul qilinmadi',
          detail: `#${o.code} · ${somText(o.totalSom)} so‘m · ${minutes(ageSec(o.createdAt, now))} daqiqa`, since: o.createdAt });
      }
    } else if (o.status === 'PAYMENT_PENDING' && method === CARD_MANUAL && pstatus === RESTAURANT_CHECK) {
      // "Shirin" mode: the order waits for the restaurant to look at its bank and confirm (or reject). Same urgency as an unverified payment.
      if (ageSec(o.createdAt, now) >= cfg.unverifiedSeconds) {
        out.push({ ...base, key: `PAYMENT_UNVERIFIED:${o.id}`, kind: 'PAYMENT_UNVERIFIED', title: 'Restoran to‘lovni tasdiqlamadi',
          detail: `#${o.code} · ${somText(o.totalSom)} so‘m · ${minutes(ageSec(o.createdAt, now))} daqiqa`, since: o.createdAt });
      }
    } else if (o.status === 'PAYMENT_MATCHED_UNVERIFIED') {
      const since = o.payment?.matchedAt ?? o.updatedAt;
      if (ageSec(since, now) >= cfg.unverifiedSeconds) {
        out.push({ ...base, key: `PAYMENT_UNVERIFIED:${o.id}`, kind: 'PAYMENT_UNVERIFIED', title: 'To‘lov kelgan, lekin tasdiqlanmadi',
          detail: `#${o.code} · ${somText(o.totalSom)} so‘m · ${minutes(ageSec(since, now))} daqiqa`, since });
      }
    } else if ((method === 'CARD' || method === CARD_MANUAL) && o.prepChosenMinutes === null && (o.status === 'PREPARING' || o.status === 'PAYMENT_CONFIRMED')) {
      // A paid order the kitchen has not acknowledged (the one-tap "SET_PREP_TIME" silences the app's bell).
      const since = o.status === 'PREPARING' ? (o.preparingStartedAt ?? o.paymentVerifiedAt ?? o.updatedAt) : (o.paymentVerifiedAt ?? o.updatedAt);
      if (ageSec(since, now) >= cfg.unseenSeconds) {
        out.push({ ...base, key: `ORDER_UNSEEN:${o.id}`, kind: 'ORDER_UNSEEN', title: 'Restoran to‘langan buyurtmani ko‘rmadi',
          detail: `#${o.code} · ${somText(o.totalSom)} so‘m · ${minutes(ageSec(since, now))} daqiqa`, since });
      }
    }

    if (o.status === 'PREPARING' || o.status === 'READY') {
      const d = o.taxiDispatches[0];
      const stage = d ? taxiStage(d.status) : null;
      if (stage === 'NEEDS_HELP' && d) {
        out.push({ ...base, key: `TAXI_NEEDS_HELP:${o.id}`, kind: 'TAXI_NEEDS_HELP', title: 'Taksi so‘rovi muammoli',
          detail: `#${o.code} · ${d.taxiCompany.name} · ${d.status}`, since: d.updatedAt });
      } else if (o.status === 'READY' && o.deliveryMode === 'TAXI' && o.readyAt && ageSec(o.readyAt, now) >= cfg.readyNoTaxiSeconds
        && (stage === null || stage === 'SCHEDULED' || stage === 'REQUESTED' || stage === 'ACCEPTED' || stage === 'CANCELLED')) {
        const what = stage === null ? 'taksi chaqirilmagan' : stage === 'CANCELLED' ? 'taksi bekor qilingan' : stage === 'ACCEPTED' ? 'haydovchi yuborilmagan' : 'taksi operatori javob bermagan';
        out.push({ ...base, key: `READY_NO_TAXI:${o.id}`, kind: 'READY_NO_TAXI', title: 'Buyurtma tayyor, taksi yo‘q',
          detail: `#${o.code} · ${what} · ${minutes(ageSec(o.readyAt, now))} daqiqa`, since: o.readyAt });
      } else if (o.status === 'READY' && stage === 'DISPATCHED' && d?.dispatchedAt && ageSec(d.dispatchedAt, now) >= cfg.notDeliveredSeconds) {
        out.push({ ...base, key: `NOT_DELIVERED:${o.id}`, kind: 'NOT_DELIVERED', title: 'Haydovchi yuborilgan, yetkazildi deb belgilanmagan',
          detail: `#${o.code} · ${d.taxiCompany.name} · ${minutes(ageSec(d.dispatchedAt, now))} daqiqa`, since: d.dispatchedAt });
      }
    }

    const w = restaurantWaitingSince(o);
    if (w) {
      const cur = waiting.get(o.restaurant.id);
      if (cur) { cur.count++; if (w < cur.since) cur.since = w; } else waiting.set(o.restaurant.id, { since: w, count: 1, restaurant: o.restaurant });
    }
  }
  for (const [id, w] of waiting) {
    if (online.has(id) || ageSec(w.since, now) < cfg.offlineSeconds) continue;
    out.push({ key: `RESTAURANT_OFFLINE:${id}`, kind: 'RESTAURANT_OFFLINE', title: 'Restoran ilovasi aloqada emas',
      detail: `${w.count} ta buyurtma kutmoqda · ${minutes(ageSec(w.since, now))} daqiqa`, restaurant: ref(w.restaurant), orderCode: null, since: w.since });
  }
  return out;
}

export const TURNOVER_MID = 0.7;
export const TURNOVER_HIGH = 0.9;

/** Pure. Pool cards at 70% / 90% of the turnover cap (cap 0 = unlimited = no warning). Only the higher level is raised for a card. */
export function evaluateTurnover(cards: ReadonlyArray<{ id: string; last4: string }>, turnoverSom: ReadonlyMap<string, number>, capSom: number): RawItem[] {
  if (capSom <= 0) return [];
  const out: RawItem[] = [];
  for (const c of cards) {
    const used = turnoverSom.get(c.id) ?? 0;
    const ratio = used / capSom;
    if (ratio < TURNOVER_MID) continue;
    const high = ratio >= TURNOVER_HIGH;
    out.push({
      key: `${high ? 'CARD_TURN_HIGH' : 'CARD_TURN_MID'}:${c.id}`, kind: high ? 'CARD_TURN_HIGH' : 'CARD_TURN_MID',
      title: `Platforma kartasi aylanmasi ${Math.floor(ratio * 100)}%`,
      detail: `***${c.last4} · ${POOL_TURNOVER_DAYS} kunda ${somText(used)} / ${somText(capSom)} so‘m${high ? ' · yangi to‘lovlar boshqa kartaga o‘tadi' : ''}`,
      restaurant: null, orderCode: null, since: null,
    });
  }
  return out;
}

/** Adds severity, age, acknowledgement and the "ring" decision; critical first, then the longest waiting. */
export function finalize(raw: RawItem[], acks: ReadonlyMap<string, Date>, quiet: boolean, now: Date): AttentionItem[] {
  return raw.map((r): AttentionItem => {
    const severity = SEVERITY[r.kind];
    const snooze = acks.get(r.key);
    const acked = snooze !== undefined && snooze > now;
    return {
      key: r.key, kind: r.kind, severity, title: r.title, detail: r.detail, restaurant: r.restaurant, orderCode: r.orderCode,
      since: r.since ? r.since.toISOString() : null, ageSeconds: r.since ? ageSec(r.since, now) : null,
      acked, snoozeUntil: acked ? snooze!.toISOString() : null,
      alarm: !acked && RING_KINDS.has(r.kind) && (severity === 'CRITICAL' || !quiet),
      notify: !acked && !RING_KINDS.has(r.kind) && !SILENT_KINDS.has(r.kind),
    };
  }).sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.ageSeconds ?? -1) - (a.ageSeconds ?? -1) || a.key.localeCompare(b.key));
}

export interface AttentionSnapshot {
  now: string;
  quiet: { from: string; to: string } | null;
  quietActive: boolean;
  items: AttentionItem[];
  counts: { total: number; alarming: number; critical: number };
}

export async function getQuietHours(): Promise<QuietHours> {
  const row = await db.platformSetting.findUnique({ where: { key: QUIET_KEY }, select: { value: true } });
  return parseQuiet(row?.value);
}

export async function computeAttention(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<AttentionSnapshot> {
  const cfg = attentionConfig(env);
  const [orders, reviews, cards, tickets, quiet, acks, poolCards, disputes, poolDue] = await Promise.all([
    db.order.findMany({ where: activeOrdersWhere(now, cfg), select: orderSelect, orderBy: { createdAt: 'asc' }, take: 300 }),
    listUnhandledReviews(5),
    db.card.findMany({ where: { approvalStatus: 'PENDING', isTest: false }, orderBy: { createdAt: 'asc' }, take: 10,
      select: { id: true, last4: true, createdAt: true, restaurant: { select: { id: true, name: true, pickupPhone: true } } } }),
    db.supportTicket.findMany({ where: { status: 'OPEN', createdAt: { lte: new Date(now.getTime() - cfg.ticketSeconds * 1000) } }, orderBy: { createdAt: 'asc' }, take: 10,
      select: { id: true, number: true, createdAt: true, order: { select: { code: true, restaurant: { select: { id: true, name: true, pickupPhone: true } } } } } }),
    getQuietHours(),
    db.adminAttentionAck.findMany({ where: { snoozeUntil: { gt: now } } }),
    db.card.findMany({ where: { restaurantId: null, isTest: false, active: true, approvalStatus: 'APPROVED' }, select: { id: true, last4: true } }),
    // The customer says the refunded money never arrived: the restaurant must prove it again, or an administrator checks and confirms.
    db.refundRequest.findMany({ where: { status: 'DISPUTED' }, orderBy: { disputedAt: 'asc' }, take: 10,
      select: { id: true, number: true, paidAmountTiyin: true, disputedAt: true, order: { select: { code: true, restaurant: { select: { id: true, name: true, pickupPhone: true } } } } } }),
    // The customer paid onto a platform card and the restaurant approved the cancellation: the money is the platform's, so the administrator sends it back.
    db.refundRequest.findMany({ where: { status: 'APPROVED', payment: { is: { method: 'CARD', card: { is: { restaurantId: null } } } } }, orderBy: { decidedAt: 'asc' }, take: 10,
      select: { id: true, number: true, approvedAmountTiyin: true, paidAmountTiyin: true, decidedAt: true, requestedAt: true, order: { select: { code: true, restaurant: { select: { id: true, name: true, pickupPhone: true } } } } } }),
  ]);

  const restaurantIds = [...new Set(orders.map(o => o.restaurant.id))];
  const sessions = restaurantIds.length
    ? await db.restaurantSession.findMany({
      where: { restaurantId: { in: restaurantIds }, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gte: new Date(now.getTime() - cfg.offlineSeconds * 1000) } },
      select: { restaurantId: true },
    })
    : [];
  const online = new Set(sessions.map(s => s.restaurantId));

  const raw: RawItem[] = evaluateOrders(orders, online, now, cfg);
  for (const r of reviews) {
    raw.push({ key: `MONEY_REVIEW:${r.id}`, kind: 'MONEY_REVIEW', title: 'Mos kelmagan pul',
      detail: `***${r.cardLast4} · ${somText(Number(r.amountTiyin / 100n))} so‘m${r.reason ? ` · ${explainReason(r.reason)}` : ''}`,
      restaurant: null, orderCode: null, since: r.emailReceivedAt ?? r.occurredAt });
  }
  for (const c of cards) {
    raw.push({ key: `CARD_PENDING:${c.id}`, kind: 'CARD_PENDING', title: 'Yangi karta tasdig‘ini kutmoqda',
      detail: `***${c.last4}${c.restaurant ? ` · ${c.restaurant.name}` : ' · platforma'}`, restaurant: c.restaurant ? { id: c.restaurant.id, name: c.restaurant.name, phone: c.restaurant.pickupPhone } : null,
      orderCode: null, since: c.createdAt });
  }
  for (const t of tickets) {
    raw.push({ key: `SUPPORT_TICKET:${t.id}`, kind: 'SUPPORT_TICKET', title: 'Mijoz murojaati javobsiz',
      detail: `Murojaat #${t.number}${t.order ? ` · buyurtma #${t.order.code}` : " · buyurtmasiz"}`, restaurant: t.order ? { id: t.order.restaurant.id, name: t.order.restaurant.name, phone: t.order.restaurant.pickupPhone } : null,
      orderCode: t.order?.code ?? null, since: t.createdAt });
  }
  for (const d of disputes) {
    raw.push({ key: `REFUND_DISPUTED:${d.id}`, kind: 'REFUND_DISPUTED', title: 'Qaytarish: mijoz pul KELMADI dedi',
      detail: `Qaytarish #${d.number} · buyurtma #${d.order.code} · ${somText(Number(d.paidAmountTiyin / 100n))} so‘m`,
      restaurant: { id: d.order.restaurant.id, name: d.order.restaurant.name, phone: d.order.restaurant.pickupPhone }, orderCode: d.order.code, since: d.disputedAt });
  }
  for (const d of poolDue) {
    raw.push({ key: `REFUND_POOL_DUE:${d.id}`, kind: 'REFUND_POOL_DUE', title: 'Qaytarish: pul platforma kartasida — mijozga qaytaring',
      detail: `Qaytarish #${d.number} · buyurtma #${d.order.code} · ${somText(Number((d.approvedAmountTiyin ?? d.paidAmountTiyin) / 100n))} so‘m`,
      restaurant: { id: d.order.restaurant.id, name: d.order.restaurant.name, phone: d.order.restaurant.pickupPhone }, orderCode: d.order.code, since: d.decidedAt ?? d.requestedAt });
  }
  const cap = poolCapSom(env);
  if (cap > 0 && poolCards.length) raw.push(...evaluateTurnover(poolCards, await cardTurnoverSom(db, poolCards.map(c => c.id), now), cap));
  if (gmailHealth.status() === 'down') {
    raw.push({ key: 'GMAIL_DOWN:gmail', kind: 'GMAIL_DOWN', title: 'Gmail o‘qilmayapti: to‘lovlar tanilmaydi', detail: 'Bank xabarlari kelmayapti. Mijozlar to‘lagan bo‘lishi mumkin.', restaurant: null, orderCode: null, since: null });
  }

  const quietActive = inQuietHours(quiet, now);
  const items = finalize(raw, new Map(acks.map(a => [a.key, a.snoozeUntil])), quietActive, now);
  return {
    now: now.toISOString(), quiet, quietActive, items,
    counts: { total: items.length, alarming: items.filter(i => i.alarm).length, critical: items.filter(i => i.severity === 'CRITICAL').length },
  };
}

// ---- acknowledgement and settings ----
export const ATTENTION_KEY_RE = /^[A-Z_]{3,30}:[A-Za-z0-9_-]{1,60}$/;

export async function ackAttention(input: { adminId: string; key: string; minutes?: number }, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<{ snoozeUntil: Date }> {
  if (!ATTENTION_KEY_RE.test(input.key)) throw Object.assign(new Error('KEY_INVALID'), { statusCode: 400 });
  const minutesWanted = input.minutes ?? attentionConfig(env).snoozeMinutes;
  const snoozeUntil = new Date(now.getTime() + minutesWanted * 60_000);
  await db.$transaction(async tx => {
    await tx.adminAttentionAck.upsert({
      where: { key: input.key }, create: { key: input.key, ackedBy: input.adminId, ackedAt: now, snoozeUntil }, update: { ackedBy: input.adminId, ackedAt: now, snoozeUntil },
    });
    await tx.adminAttentionAck.deleteMany({ where: { snoozeUntil: { lt: new Date(now.getTime() - 86_400_000) } } });
    await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'ATTENTION_ACK', targetType: 'AdminAttentionAck', targetId: input.key, details: { minutes: minutesWanted } } });
  });
  return { snoozeUntil };
}

export async function setQuietHours(input: { adminId: string; quiet: QuietHours }): Promise<void> {
  const value = formatQuiet(input.quiet);
  await db.$transaction(async tx => {
    const before = await tx.platformSetting.findUnique({ where: { key: QUIET_KEY }, select: { value: true } });
    await tx.platformSetting.upsert({ where: { key: QUIET_KEY }, create: { key: QUIET_KEY, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'ADMIN_QUIET_HOURS', targetType: 'PlatformSetting', targetId: QUIET_KEY, details: { previous: before?.value ?? null, value } } });
  });
}
