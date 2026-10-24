import type { Prisma, TaxiDispatchStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { completeDelivery, respondToTaxi, taxiDispatchDetails } from '../taxi/service.js';
import type { OperatorAction } from '../taxi/workflow.js';

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
  } },
} satisfies Prisma.TaxiDispatchInclude;
type Row = Prisma.TaxiDispatchGetPayload<{ include: typeof include }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toRequestView(d: Row) {
  const o = d.order;
  const estimatedReadyAt = o.preparingStartedAt && o.prepMinutes ? new Date(o.preparingStartedAt.getTime() + o.prepMinutes * 60_000) : null;
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
    food: { ready, status: o.status, prepMinutes: o.prepMinutes, estimatedReadyAt: iso(estimatedReadyAt), readyAt: iso(o.readyAt), totalSom: o.totalSom },
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
  return { serverNow: now.toISOString(), active: active.map(toRequestView), history: history.map(toRequestView) };
}

export async function getRequest(companyId: string, dispatchId: string): Promise<TaxiRequestView | null> {
  const row = await db.taxiDispatch.findFirst({ where: { id: dispatchId, taxiCompanyId: companyId }, include });
  return row ? toRequestView(row) : null;
}

export class TaxiAppError extends Error {
  constructor(readonly code: string, readonly status: number) { super(ERRORS[code] ?? code); }
}

/** One operator answer. The same state machine as the Telegram buttons (respondToTaxi / completeDelivery), authorized by the session's company. */
export async function act(companyId: string, dispatchId: string, action: AppAction) {
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
