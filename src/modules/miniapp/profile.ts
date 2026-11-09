import { Prisma, type CustomerAddress } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { customerWhere, type CustomerOwner } from '../../lib/customer-owner.js';
import { nextAutoLabel } from './address-label.js';

/** Customer profile for the Mini App: phone and saved delivery addresses, owned by the authenticated Telegram user. */
export class ProfileError extends Error {
  constructor(readonly statusCode: number, code: string) { super(code); }
}
export const MAX_ADDRESSES = 10;

export const phoneSchema = z.string().trim().regex(/^\+998\d{9}$/, 'phone');
const coords = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() };
const withPairedCoords = <T extends z.ZodTypeAny>(schema: T) => schema.refine((x: { lat?: number; lng?: number }) => (x.lat === undefined) === (x.lng === undefined), { message: 'lat/lng together' });
// The label is optional (owner decision 2026-11-09: one address field; the name is numbered automatically). Older apps still send one.
export const addressInputSchema = withPairedCoords(z.object({
  label: z.string().trim().min(1).max(30).optional(),
  addressText: z.string().trim().min(3).max(500),
  ...coords,
  makeDefault: z.boolean().optional(),
}).strict());
export const addressUpdateSchema = withPairedCoords(z.object({
  label: z.string().trim().min(1).max(30).optional(),
  addressText: z.string().trim().min(3).max(500),
  ...coords,
}).strict());
export const phoneBodySchema = z.object({ phone: phoneSchema }).strict();
export type AddressInput = z.infer<typeof addressInputSchema>;

export const addressView = (a: CustomerAddress) => ({
  id: a.id, label: a.label, addressText: a.addressText, lat: a.lat, lng: a.lng, isDefault: a.isDefault, lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
});

/** Concurrent first requests of a NEW Telegram user (the app fires several calls on open) all miss the row; Prisma's upsert is not atomic, so the
 *  losers hit the unique telegramUserId. That is not an error: the row exists now, read it. */
export async function ensureCustomer(telegramUserId: string, displayName: string | null) {
  try {
    return await db.customer.upsert({
      where: { telegramUserId }, create: { telegramUserId, ...(displayName ? { displayName } : {}) }, update: {},
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    return db.customer.findUniqueOrThrow({ where: { telegramUserId } });
  }
}

const ordered = [{ isDefault: 'desc' as const }, { lastUsedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];

export async function getProfile(owner: CustomerOwner) {
  const customer = await db.customer.findFirst({ where: customerWhere(owner), select: { id: true, phone: true, displayName: true, telegramUserId: true } });
  if (!customer) return { phone: null, displayName: null, telegramLinked: typeof owner === 'string', addresses: [] as ReturnType<typeof addressView>[], defaultAddressId: null, lastUsedAddressId: null };
  const addresses = await db.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: ordered });
  const lastUsed = addresses.filter(a => a.lastUsedAt).sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime())[0];
  return {
    phone: customer.phone, displayName: customer.displayName, telegramLinked: customer.telegramUserId !== null, addresses: addresses.map(addressView),
    defaultAddressId: addresses.find(a => a.isDefault)?.id ?? null, lastUsedAddressId: lastUsed?.id ?? null,
  };
}

export async function setPhone(customerId: string, phone: string) {
  await db.customer.update({ where: { id: customerId }, data: { phone } });
  return { phone };
}

/** Serializes concurrent profile writes of ONE customer (two taps, two devices) so counts and the single default stay consistent. */
async function lockCustomer(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
}

export async function createAddress(customerId: string, input: AddressInput) {
  return db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const existing = await tx.customerAddress.findMany({ where: { customerId }, select: { label: true } });
    const count = existing.length;
    if (count >= MAX_ADDRESSES) throw new ProfileError(409, 'ADDRESS_LIMIT');
    const makeDefault = input.makeDefault === true || count === 0;
    if (makeDefault) await tx.customerAddress.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
    const created = await tx.customerAddress.create({ data: {
      customerId, label: input.label ?? nextAutoLabel(existing.map(e => e.label)), addressText: input.addressText, lat: input.lat ?? null, lng: input.lng ?? null, isDefault: makeDefault,
    } });
    return addressView(created);
  });
}

export async function updateAddress(customerId: string, addressId: string, input: z.infer<typeof addressUpdateSchema>) {
  return db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const found = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } }); // another customer's id = not found
    if (!found) throw new ProfileError(404, 'NOT_FOUND');
    const updated = await tx.customerAddress.update({ where: { id: found.id }, data: {
      ...(input.label !== undefined ? { label: input.label } : {}), addressText: input.addressText, lat: input.lat ?? null, lng: input.lng ?? null,
    } });
    return addressView(updated);
  });
}

export async function setDefaultAddress(customerId: string, addressId: string) {
  return db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const found = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!found) throw new ProfileError(404, 'NOT_FOUND');
    await tx.customerAddress.updateMany({ where: { customerId, isDefault: true, id: { not: found.id } }, data: { isDefault: false } });
    return addressView(await tx.customerAddress.update({ where: { id: found.id }, data: { isDefault: true } }));
  });
}

export async function deleteAddress(customerId: string, addressId: string) {
  await db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const found = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!found) throw new ProfileError(404, 'NOT_FOUND');
    await tx.customerAddress.delete({ where: { id: found.id } });
    if (found.isDefault) {
      // keep a default whenever any address remains: the most recently used, else the newest
      const next = await tx.customerAddress.findFirst({ where: { customerId }, orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] });
      if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

export async function touchAddress(customerId: string, addressId: string) {
  await db.customerAddress.updateMany({ where: { id: addressId, customerId }, data: { lastUsedAt: new Date() } });
}

/** Resolves an address the caller may use for an order: it must belong to the caller. */
export async function ownedAddress(customerId: string, addressId: string) {
  const a = await db.customerAddress.findFirst({ where: { id: addressId, customerId } });
  if (!a) throw new ProfileError(404, 'ADDRESS_NOT_FOUND');
  return a;
}
