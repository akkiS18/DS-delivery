import { db } from '../../lib/db.js';
import { eligibleCompanyWhere, reassignableCompanies } from '../taxi/assignment.js';
import { RECOVERABLE, dispatchHistory, recoverableDispatches } from '../taxi/recovery.js';

/**
 * DS Admin app, A4b: taxi problems (the bot's /taxiadmin) and taxi companies (/newtaxi, /taxiapp, /deletetaxi). Reads are assembled here;
 * every change calls the same guarded service as the bot (adminRecoverDispatch, createTaxiCompanyByAdmin, resetTaxiAccessByAdmin, removeTaxiCompany).
 */
export interface ProblemRow {
  id: string; orderCode: string; restaurantName: string; companyName: string; status: string; attemptNo: number; updatedAt: string;
}

export async function listProblems(): Promise<ProblemRow[]> {
  const rows = await recoverableDispatches(30);
  const restaurants = await db.order.findMany({ where: { id: { in: rows.map(r => r.orderId) } }, select: { id: true, restaurant: { select: { name: true } } } });
  const byOrder = new Map(restaurants.map(o => [o.id, o.restaurant.name]));
  return rows.map(r => ({
    id: r.id, orderCode: r.order.code, restaurantName: byOrder.get(r.orderId) ?? '', companyName: r.taxiCompany.name,
    status: r.status, attemptNo: r.attemptNo, updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface ProblemDetail {
  id: string; orderCode: string; orderStatus: string; restaurantName: string; addressText: string;
  attemptNo: number; companyName: string; status: string;
  history: Array<{ attemptNo: number; companyName: string; status: string }>;
  /** True while the administrator can still act: this is the latest attempt and it is one of the recoverable states. */
  open: boolean;
  companies: Array<{ id: string; name: string }>;
}

export async function problemDetail(id: string): Promise<ProblemDetail | null> {
  const d = await db.taxiDispatch.findUnique({
    where: { id },
    include: { taxiCompany: { select: { name: true } }, order: { select: { code: true, status: true, addressText: true, restaurant: { select: { name: true } } } } },
  });
  if (!d) return null;
  const history = await dispatchHistory(d.orderId);
  const open = (RECOVERABLE as readonly string[]).includes(d.status) && !history.some(h => h.attemptNo > d.attemptNo);
  return {
    id: d.id, orderCode: d.order.code, orderStatus: d.order.status, restaurantName: d.order.restaurant.name, addressText: d.order.addressText,
    attemptNo: d.attemptNo, companyName: d.taxiCompany.name, status: d.status,
    history: history.map(h => ({ attemptNo: h.attemptNo, companyName: h.taxiCompany.name, status: h.status })),
    open, companies: open ? await reassignableCompanies(db) : [],
  };
}

export interface CompanyRow {
  id: string; name: string; isActive: boolean; login: string | null; operatorLinked: boolean;
  /** Can receive a booking right now (same rule the dispatcher uses). */
  reachable: boolean;
}

export async function listCompanies(): Promise<CompanyRow[]> {
  const rows = await db.taxiCompany.findMany({
    where: { NOT: { name: { contains: '[arxiv' } } }, orderBy: { name: 'asc' }, take: 100,
    select: { id: true, name: true, isActive: true, operatorTelegramUserId: true, credential: { select: { login: true } } },
  });
  const eligible = new Set((await db.taxiCompany.findMany({ where: { ...eligibleCompanyWhere(), id: { in: rows.map(r => r.id) } }, select: { id: true } })).map(c => c.id));
  return rows.map(c => ({
    id: c.id, name: c.name, isActive: c.isActive, login: c.credential?.login ?? null, operatorLinked: c.operatorTelegramUserId !== null,
    reachable: eligible.has(c.id),
  }));
}
