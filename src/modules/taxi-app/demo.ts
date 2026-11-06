import { Prisma, type TaxiDemoRequest, type TaxiDispatchStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { db } from '../../lib/db.js';
import { operatorTransition, type OperatorAction } from '../taxi/workflow.js';

/**
 * Sinov (demo) request for a taxi operator: an administrator sends a fake request into one company's DS Taxi app so that the operator can SEE it and
 * practise the buttons (Qabul qildim -> Taksi yuborildi -> Yetkazildi). Owner request 2026-11-06. The operator himself sends nobody: in real work too the
 * driver is sent by a person outside this system, the app only records the operator's taps.
 *
 * Safety: this is NOT a TaxiDispatch and has no Order. It lives in its own table, so the dispatch worker (timeouts, escalation, Telegram messages), the
 * restaurant, the customer, commission and every admin alert never see it. The taps change only this row and are never written to any history; a finished
 * request (delivered / "no taxi") is deleted at once, an unfinished one after DEMO_TAXI_MAX_AGE_MS. One per company (unique index).
 */
export const DEMO_TAXI_MAX_AGE_MS = 30 * 60_000;
const RESTAURANT = { name: 'Sinov oshxona', address: 'Toshkent, Sinov ko‘chasi 1', phone: '+998 00 000 00 00' };
const DELIVERY = { address: 'SINOV manzil (haqiqiy emas) — Toshkent, Namuna ko‘chasi 5, 12-xonadon', customerPhone: '+998 00 000 00 01' };
export type TaxiDemoAction = 'ACCEPT' | 'SENT' | 'NO_TAXI' | 'DELIVERED';

const ACTIONS: Partial<Record<TaxiDispatchStatus, TaxiDemoAction[]>> = {
  REQUESTED: ['ACCEPT', 'NO_TAXI'], ACCEPTED: ['SENT', 'NO_TAXI'], ASSIGNED: ['DELIVERED'],
};

const iso = (d: Date): string => d.toISOString();

/** The same JSON a real request has (taxi-app/service.ts toRequestView), so the installed apps show it without any change. */
export function demoRequestView(d: TaxiDemoRequest, now = new Date()) {
  const ended = d.status === 'DELIVERED' || d.status === 'DECLINED';
  return {
    id: d.id,
    orderCode: d.code,
    status: d.status,
    attention: d.status === 'REQUESTED',
    attemptNo: 1,
    createdAt: iso(d.createdAt),
    sentAt: iso(d.createdAt),
    answerBy: null as string | null,
    updatedAt: iso(d.updatedAt),
    deliveredAt: d.status === 'DELIVERED' ? iso(d.updatedAt) : null,
    isTest: true,
    restaurant: { name: RESTAURANT.name, address: RESTAURANT.address as string | null, phone: RESTAURANT.phone as string | null },
    delivery: { address: DELIVERY.address, lat: null as number | null, lng: null as number | null, customerPhone: DELIVERY.customerPhone as string | null },
    food: { ready: true, status: 'READY' as const, prepMinutes: null, estimatedReadyAt: null as string | null, readyAt: iso(now), totalSom: d.totalSom },
    payment: d.cash ? { method: 'CASH' as const, payRestaurantSom: d.totalSom } : { method: 'CARD' as const, payRestaurantSom: 0 },
    actions: ended ? [] : (ACTIONS[d.status] ?? []),
    deliverBlockedReason: null as string | null,
  };
}

export type TaxiDemoCreated = { result: 'CREATED'; id: string; code: string; companyName: string } | { result: 'NOT_FOUND' } | { result: 'BUSY' };

export async function createTaxiDemoRequest(companyId: string, cash: boolean): Promise<TaxiDemoCreated> {
  const company = await db.taxiCompany.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company || company.name.includes('[arxiv')) return { result: 'NOT_FOUND' };
  const totalSom = 3_000 * randomInt(20, 60); // 60 000 .. 177 000, looks like a real basket
  try {
    const row = await db.$transaction(async tx => {
      await tx.taxiDemoRequest.deleteMany({ where: { taxiCompanyId: company.id } }); // one per company: a new one replaces the old one
      return tx.taxiDemoRequest.create({ data: { taxiCompanyId: company.id, code: `SINOV-${randomInt(100, 1000)}`, cash, totalSom } });
    });
    return { result: 'CREATED', id: row.id, code: row.code, companyName: company.name };
  } catch (err) {
    // Two administrators pressed at the same moment: the unique index let only one through.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { result: 'BUSY' };
    throw err;
  }
}

/** Demo requests this company's app may show (the age check keeps a forgotten one from showing even if the sweep is not running). */
export async function listTaxiDemoRequests(companyId: string, now = new Date()): Promise<TaxiDemoRequest[]> {
  return db.taxiDemoRequest.findMany({ where: { taxiCompanyId: companyId, createdAt: { gte: new Date(now.getTime() - DEMO_TAXI_MAX_AGE_MS) } } });
}

export async function getTaxiDemoRequest(companyId: string, id: string): Promise<TaxiDemoRequest | null> {
  return db.taxiDemoRequest.findFirst({ where: { id, taxiCompanyId: companyId } });
}

export type TaxiDemoOutcome = { changed: boolean; finalStatus: TaxiDispatchStatus | 'STALE'; request: ReturnType<typeof demoRequestView> };

/** One operator tap on a demo request. Compare-and-swap on the status; a repeated or out-of-order tap is "stale" and changes nothing. */
export async function actOnTaxiDemo(row: TaxiDemoRequest, action: TaxiDemoAction): Promise<TaxiDemoOutcome> {
  let to: TaxiDispatchStatus;
  if (action === 'DELIVERED') {
    if (row.status !== 'ASSIGNED') return { changed: false, finalStatus: 'STALE', request: demoRequestView(row) };
    to = 'DELIVERED';
  } else {
    try { to = operatorTransition(row.status as Parameters<typeof operatorTransition>[0], action as OperatorAction); }
    catch { return { changed: false, finalStatus: 'STALE', request: demoRequestView(row) }; }
  }
  const moved = await db.taxiDemoRequest.updateMany({ where: { id: row.id, status: row.status }, data: { status: to } });
  if (moved.count !== 1) {
    const fresh = await db.taxiDemoRequest.findUnique({ where: { id: row.id } });
    return { changed: false, finalStatus: 'STALE', request: demoRequestView(fresh ?? row) };
  }
  const updated = await db.taxiDemoRequest.findUnique({ where: { id: row.id } });
  const view = demoRequestView(updated ?? { ...row, status: to, updatedAt: new Date() });
  // The demo is over once the operator answered "no taxi" or confirmed the delivery: nothing stays in any list or history.
  if (to === 'DELIVERED' || to === 'DECLINED') await db.taxiDemoRequest.deleteMany({ where: { id: row.id } });
  return { changed: true, finalStatus: to, request: view };
}

export async function sweepTaxiDemoRequests(now = new Date()): Promise<number> {
  return (await db.taxiDemoRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DEMO_TAXI_MAX_AGE_MS) } } })).count;
}

export async function removeTaxiDemoRequest(companyId: string): Promise<number> {
  return (await db.taxiDemoRequest.deleteMany({ where: { taxiCompanyId: companyId } })).count;
}
