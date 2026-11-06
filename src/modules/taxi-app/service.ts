import type { Prisma, TaxiDispatchStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { completeDelivery, respondToTaxi, taxiDispatchDetails } from '../taxi/service.js';
import type { OperatorAction } from '../taxi/workflow.js';
import { actOnTaxiDemo, demoRequestView, getTaxiDemoRequest, listTaxiDemoRequests } from './demo.js';

/** What the DS Taxi app shows. Everything is scoped to the signed-in company; the dispatch id alone never grants access. */
export const ACTIVE_STATUSES: TaxiDispatchStatus[] = ['REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'NEEDS_HELP', 'ASSIGNED'];
const HISTORY_STATUSES: TaxiDispatchStatus[] = ['DELIVERED', 'DECLINED', 'CANCELLED'];
/** The app rings until the operator answers these: a new request, a late one that must be clarified, one the system could not deliver. */
const ATTENTION: TaxiDispatchStatus[] = ['REQUESTED', 'CANCELLATION_PENDING', 'NEEDS_HELP'];
export type AppAction = 'ACCEPT' | 'SENT' | 'NO_TAXI' | 'DELIVERED';

const ACTIONS: Partial<Record<TaxiDispatchStatus, AppAction[]>> = {
  REQUESTED: ['ACCEPT', 'NO_TAXI'],
  ACCEPTED: ['SENT', 'NO_TAXI'],
  CANCELLATION_PENDING: ['SENT', 'NO_TAXI'],
  NEEDS_HELP: ['SENT', 'NO_TAXI'],
  ASSIGNED: ['DELIVERED'],
};

export const ERRORS: Record<string, string> = {
  TAKSI_OPERATOR_RUXSAT_YOQ: 'Ruxsat yo‘q.',
  TAKSI_SOROVI_TOPILMADI: 'So‘rov topilmadi.',
  TAKSI_SOROVI_ESKIRGAN: 'Bu amal eskirgan. Ro‘yxatni yangilang.',
  TAKSI_HALI_YUBORILMAGAN: 'Avval „Taksi yuborildi“ni bosing — haydovchi yuborilmagan so‘rov yetkazildi deb belgilanmaydi.',
  BUYURTMA_HALI_TAYYOR_EMAS: 'Taom hali tayyor emas. Restoran „Tayyor“ni belgilagandan keyin tasdiqlang.',
  BUYURTMA_BEKOR_QILINGAN: 'Buyurtma bekor qilingan, yetkazishni tasdiqlab bo‘lmaydi.',
  QAYTARISH_JARAYONIDA: 'Bu buyurtma bo‘yicha pulni qaytarish jarayoni bor, yetkazishni tasdiqlab bo‘lmaydi.',
  TOLOV_TASDIQLANMAGAN: 'Buyurtma to‘lovi tasdiqlanmagan.',
  BUYURTMA_YETKAZISH_UCHUN_FAOL_EMAS: 'Buyurtma yetkazish uchun faol emas.',
};

const include = {
  order: { select: {
    code: true, status: true, addressText: true, deliveryLat: true, deliveryLng: true, phoneSnapshot: true, totalSom: true,
    prepMinutes: true, preparingStartedAt: true, readyAt: true, paymentIsTest: true,
    restaurant: { select: { name: true, pickupAddress: true, pickupPhone: true } },
    payment: { select: { method: true } },
  } },
} satisfies Prisma.TaxiDispatchInclude;
type Row = Prisma.TaxiDispatchGetPayload<{ include: typeof include }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toRequestView(d: Row) {
  const o = d.order;
  const estimatedReadyAt: Date | null = null; // no preparation time is promised any more (2026-10-27): the driver goes by the "Tayyor" signal
  const ready = o.status === 'READY';
  return {
    id: d.id,
    orderCode: o.code,
    status: d.status,
    attention: ATTENTION.includes(d.status),
    attemptNo: d.attemptNo,
    createdAt: d.createdAt.toISOString(),
    sentAt: iso(d.sentAt),
    answerBy: d.status === 'REQUESTED' ? iso(d.expiresAt) : null,
    updatedAt: d.updatedAt.toISOString(),
    deliveredAt: iso(d.deliveredAt),
    isTest: o.paymentIsTest,
    restaurant: { name: o.restaurant.name, address: o.restaurant.pickupAddress ?? null, phone: o.restaurant.pickupPhone ?? null },
    delivery: { address: o.addressText, lat: o.deliveryLat, lng: o.deliveryLng, customerPhone: o.phoneSnapshot ?? null },
    food: { ready, status: o.status, prepMinutes: null, estimatedReadyAt: iso(estimatedReadyAt), readyAt: iso(o.readyAt), totalSom: o.totalSom },
    // CASH: the driver pays the restaurant `payRestaurantSom` at pickup and collects it from the customer; CARD: already paid, nothing to pay.
    payment: o.payment?.method === 'CASH'
      ? { method: 'CASH' as const, payRestaurantSom: o.totalSom }
      : { method: 'CARD' as const, payRestaurantSom: 0 },
    actions: ACTIONS[d.status] ?? [],
    deliverBlockedReason: d.status === 'ASSIGNED' && !ready ? ERRORS.BUYURTMA_HALI_TAYYOR_EMAS! : null,
  };
}
export type TaxiRequestView = ReturnType<typeof toRequestView>;

export async function listRequests(companyId: string, now = new Date()) {
  const [active, history] = await Promise.all([
    db.taxiDispatch.findMany({ where: { taxiCompanyId: companyId, status: { in: ACTIVE_STATUSES } }, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 }),
    db.taxiDispatch.findMany({
      where: { taxiCompanyId: companyId, status: { in: HISTORY_STATUSES }, updatedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
      include, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 30,
    }),
  ]);
  // An admin "sinov" request (taxi-app/demo.ts) is shown next to the real ones, oldest first, and never reaches the history list.
  const demo = (await listTaxiDemoRequests(companyId, now)).map(d => demoRequestView(d, now));
  const shown = [...active.map(toRequestView), ...demo].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { serverNow: now.toISOString(), active: shown, history: history.map(toRequestView) };
}

export async function getRequest(companyId: string, dispatchId: string): Promise<TaxiRequestView | null> {
  const row = await db.taxiDispatch.findFirst({ where: { id: dispatchId, taxiCompanyId: companyId }, include });
  if (row) return toRequestView(row);
  const demo = await getTaxiDemoRequest(companyId, dispatchId);
  return demo ? demoRequestView(demo) : null;
}

export class TaxiAppError extends Error {
  constructor(readonly code: string, readonly status: number) { super(ERRORS[code] ?? code); }
}

/** One operator answer. The same state machine as the Telegram buttons (respondToTaxi / completeDelivery), authorized by the session's company. */
export async function act(companyId: string, dispatchId: string, action: AppAction) {
  // An admin "sinov" request has its own tiny state machine: it never reaches respondToTaxi / completeDelivery (no order, no commission, no history).
  const demo = await getTaxiDemoRequest(companyId, dispatchId);
  if (demo) {
    const r = await actOnTaxiDemo(demo, action);
    return { changed: r.changed, finalStatus: r.finalStatus, fallbackCompany: null, request: r.request as TaxiRequestView | null };
  }
  const known = await taxiDispatchDetails('', dispatchId, companyId);
  if (!known) throw new TaxiAppError('TAKSI_SOROVI_TOPILMADI', 404); // another company's request looks exactly like a missing one
  const actor = { actorTelegramId: `app:${companyId}`, actorCompanyId: companyId, dispatchId };
  try {
    if (action === 'DELIVERED') {
      const r = await completeDelivery(actor);
      return { changed: r.changed, finalStatus: 'DELIVERED' as const, fallbackCompany: null, request: await getRequest(companyId, dispatchId) };
    }
    const r = await respondToTaxi({ ...actor, action: action as OperatorAction });
    return { changed: r.changed, finalStatus: r.finalStatus, fallbackCompany: r.fallbackCompany, request: await getRequest(companyId, dispatchId) };
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code in ERRORS) throw new TaxiAppError(code, code === 'TAKSI_OPERATOR_RUXSAT_YOQ' ? 403 : 409);
    throw err;
  }
}
