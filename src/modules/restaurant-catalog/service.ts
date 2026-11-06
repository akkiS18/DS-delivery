import { Prisma, type Category, type Product } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';

export class CatalogError extends Error {
  constructor(readonly statusCode: number, code: string) { super(code); }
}
const fail = (status: number, code: string): never => { throw new CatalogError(status, code); };

// ---- input contracts (strict: unknown fields such as restaurantId or imageUrl are rejected) ----
const name = z.string().trim().min(2).max(100);
const version = z.number().int().min(0).max(2_000_000_000);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const idSchema = id;
export const productCreateSchema = z.object({
  name,
  description: z.string().trim().max(1000).nullable().optional(),
  priceSom: z.number().int().min(100).max(100_000_000),
  categoryId: id.nullable().optional(),
  isAvailable: z.boolean().optional(),
}).strict();
export const productUpdateSchema = z.object({
  name,
  description: z.string().trim().max(1000).nullable(),
  priceSom: z.number().int().min(100).max(100_000_000),
  categoryId: id.nullable(),
  version,
}).strict();
export const availabilitySchema = z.object({ isAvailable: z.boolean(), version: version.optional() }).strict();
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  position: z.number().int().min(0).max(10_000).optional(),
}).strict();
export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  position: z.number().int().min(0).max(10_000),
  version,
}).strict();

// ---- views (no internal fields) ----
// imageUrl: the restaurant's own uploaded photo (a relative URL the apps put after the server address) wins over a legacy external link.
const productView = (p: Product, imageVersion: number | null = null) => ({
  id: p.id, name: p.name, description: p.description, priceSom: p.priceSom, isAvailable: p.isAvailable,
  categoryId: p.categoryId, imageUrl: imageVersion === null ? p.imageUrl : `/api/v1/miniapp/products/${p.id}/image?v=${imageVersion}`, archivedAt: p.archivedAt?.toISOString() ?? null,
  version: p.version, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});
const categoryView = (c: Category, productCount?: number, imageVersion: number | null = null) => ({
  id: c.id, name: c.name, position: c.position, version: c.version, ...(productCount !== undefined ? { productCount } : {}),
  imageUrl: imageVersion === null ? null : `/api/v1/miniapp/categories/${c.id}/image?v=${imageVersion}`,
});
const snap = (p: Product) => ({ name: p.name, description: p.description, priceSom: p.priceSom, categoryId: p.categoryId,
  isAvailable: p.isAvailable, archivedAt: p.archivedAt, version: p.version });

type Tx = Prisma.TransactionClient;
async function event(tx: Tx, restaurantId: string, sessionId: string, entity: 'PRODUCT' | 'CATEGORY', entityId: string,
  action: string, before: Prisma.InputJsonValue | null, after: Prisma.InputJsonValue | null) {
  await tx.catalogEvent.create({ data: { restaurantId, entity, entityId, action, actorSessionId: sessionId,
    ...(before ? { before } : {}), ...(after ? { after } : {}) } });
}
/** Maps DB-level violations to client errors: unique name -> 409, vanished category -> 422. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return fail(409, 'DUPLICATE_NAME');
      if (err.code === 'P2003') return fail(422, 'INVALID_CATEGORY');
    }
    throw err;
  }
}
/** The category must belong to THIS restaurant; foreign and unknown ids are the same error. */
async function assertCategory(tx: Tx, restaurantId: string, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  if (!await tx.category.findFirst({ where: { id: categoryId, restaurantId }, select: { id: true } })) fail(422, 'INVALID_CATEGORY');
}
const imageVersionOf = async (tx: Tx, productId: string): Promise<number | null> =>
  (await tx.productImage.findUnique({ where: { productId }, select: { version: true } }))?.version ?? null;
/** Row lock; a row of another restaurant is simply "not found". */
async function lockProduct(tx: Tx, restaurantId: string, productId: string): Promise<Product> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" WHERE "id" = ${productId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
  if (!rows.length) return fail(404, 'NOT_FOUND');
  return tx.product.findUniqueOrThrow({ where: { id: productId } });
}
async function lockCategory(tx: Tx, restaurantId: string, categoryId: string): Promise<Category> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Category" WHERE "id" = ${categoryId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
  if (!rows.length) return fail(404, 'NOT_FOUND');
  return tx.category.findUniqueOrThrow({ where: { id: categoryId } });
}
const restaurantLock = (tx: Tx, restaurantId: string) =>
  tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7016, hashtext(${restaurantId}))`;

// ---- products ----
export async function listProducts(restaurantId: string, includeArchived: boolean) {
  const rows = await db.product.findMany({
    where: { restaurantId, ...(includeArchived ? {} : { archivedAt: null }) }, // unavailable products ARE included
    orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 1000, include: { image: { select: { version: true } } },
  });
  return rows.map(p => productView(p, p.image?.version ?? null));
}

export async function createProduct(restaurantId: string, sessionId: string, input: z.infer<typeof productCreateSchema>) {
  return guarded(() => db.$transaction(async tx => {
    await assertCategory(tx, restaurantId, input.categoryId);
    const p = await tx.product.create({ data: {
      restaurantId, name: input.name, description: input.description ?? null, priceSom: input.priceSom,
      categoryId: input.categoryId ?? null, isAvailable: input.isAvailable ?? true,
    } });
    await event(tx, restaurantId, sessionId, 'PRODUCT', p.id, 'PRODUCT_CREATED', null, snap(p));
    return productView(p);
  }));
}

/** Full replace guarded by the client's `version`: a stale editor gets 409 VERSION_CONFLICT instead of overwriting. */
export async function updateProduct(restaurantId: string, sessionId: string, productId: string, input: z.infer<typeof productUpdateSchema>) {
  return guarded(() => db.$transaction(async tx => {
    const before = await lockProduct(tx, restaurantId, productId);
    if (before.archivedAt) fail(409, 'ARCHIVED');
    if (before.version !== input.version) fail(409, 'VERSION_CONFLICT');
    // Stage 6F: prices are frozen into an order when it is created and shown to the customer before payment. Changing a live price
    // while the restaurant is taking orders would race with customers who are checking out, so it requires "paused" (the existing
    // pause switch). Shared row lock: the restaurant cannot be resumed until this edit commits. Existing orders keep their snapshot.
    if (input.priceSom !== before.priceSom) {
      const rows = await tx.$queryRaw<Array<{ isPaused: boolean }>>`SELECT "isPaused" FROM "Restaurant" WHERE "id" = ${restaurantId} FOR SHARE`;
      if (!rows[0]?.isPaused) fail(409, 'PRICE_EDIT_REQUIRES_PAUSE');
    }
    await assertCategory(tx, restaurantId, input.categoryId);
    const after = await tx.product.update({ where: { id: productId }, data: {
      name: input.name, description: input.description, priceSom: input.priceSom, categoryId: input.categoryId,
      // a new menu price ends a "was X" offer: the crossed-out earlier price would be stale
      ...(input.priceSom !== before.priceSom ? { oldPriceSom: null } : {}),
      version: { increment: 1 },
    } });
    await event(tx, restaurantId, sessionId, 'PRODUCT', productId, 'PRODUCT_UPDATED', snap(before), snap(after));
    return productView(after, await imageVersionOf(tx, productId));
  }));
}

/** Idempotent set (not a toggle). Repeating the same value changes nothing and writes no audit row. */
export async function setAvailability(restaurantId: string, sessionId: string, productId: string, isAvailable: boolean, expected?: number) {
  return db.$transaction(async tx => {
    const before = await lockProduct(tx, restaurantId, productId);
    if (before.archivedAt) fail(409, 'ARCHIVED');
    if (expected !== undefined && before.version !== expected) fail(409, 'VERSION_CONFLICT');
    if (before.isAvailable === isAvailable) return productView(before, await imageVersionOf(tx, productId));
    const after = await tx.product.update({ where: { id: productId }, data: { isAvailable, version: { increment: 1 } } });
    await event(tx, restaurantId, sessionId, 'PRODUCT', productId, 'PRODUCT_AVAILABILITY', snap(before), snap(after));
    return productView(after, await imageVersionOf(tx, productId));
  });
}

/** "Delete" = archive. The row stays (order lines reference it and keep their own name/price snapshot);
 *  it becomes unavailable for good and frees its name. Repeating the call is a no-op. */
export async function archiveProduct(restaurantId: string, sessionId: string, productId: string): Promise<void> {
  await db.$transaction(async tx => {
    const before = await lockProduct(tx, restaurantId, productId);
    if (before.archivedAt) return;
    const after = await tx.product.update({ where: { id: productId }, data: {
      archivedAt: new Date(), isAvailable: false, version: { increment: 1 } } });
    await event(tx, restaurantId, sessionId, 'PRODUCT', productId, 'PRODUCT_ARCHIVED', snap(before), snap(after));
  });
}

// ---- categories ----
export async function listCategories(restaurantId: string) {
  const [cats, counts] = await Promise.all([
    db.category.findMany({ where: { restaurantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }], take: 500, include: { image: { select: { version: true } } } }),
    db.product.groupBy({ by: ['categoryId'], where: { restaurantId, archivedAt: null }, _count: { _all: true } }),
  ]);
  const n = new Map(counts.map(c => [c.categoryId, c._count._all]));
  return cats.map(c => categoryView(c, n.get(c.id) ?? 0, c.image?.version ?? null));
}

export async function createCategory(restaurantId: string, sessionId: string, input: z.infer<typeof categoryCreateSchema>) {
  return guarded(() => db.$transaction(async tx => {
    await restaurantLock(tx, restaurantId); // serializes the default position
    const position = input.position ?? ((await tx.category.aggregate({ where: { restaurantId }, _max: { position: true } }))._max.position ?? -1) + 1;
    const c = await tx.category.create({ data: { restaurantId, name: input.name, position: Math.min(position, 10_000) } });
    await event(tx, restaurantId, sessionId, 'CATEGORY', c.id, 'CATEGORY_CREATED', null, { name: c.name, position: c.position });
    return categoryView(c);
  }));
}

export async function updateCategory(restaurantId: string, sessionId: string, categoryId: string, input: z.infer<typeof categoryUpdateSchema>) {
  return guarded(() => db.$transaction(async tx => {
    const before = await lockCategory(tx, restaurantId, categoryId);
    if (before.version !== input.version) fail(409, 'VERSION_CONFLICT');
    const after = await tx.category.update({ where: { id: categoryId }, data: {
      name: input.name, position: input.position, version: { increment: 1 } } });
    await event(tx, restaurantId, sessionId, 'CATEGORY', categoryId, 'CATEGORY_UPDATED',
      { name: before.name, position: before.position }, { name: after.name, position: after.position });
    return categoryView(after, undefined, (await tx.categoryImage.findUnique({ where: { categoryId }, select: { version: true } }))?.version ?? null);
  }));
}

/** A category with live products is not deleted silently: 409 CATEGORY_NOT_EMPTY unless the caller says where the
 *  products go (`reassignTo` = another own category id, or "none" = uncategorised). Archived products are simply
 *  uncategorised. Orders are unaffected: order lines never reference categories. */
export async function deleteCategory(restaurantId: string, sessionId: string, categoryId: string, reassignTo?: string) {
  return guarded(() => db.$transaction(async tx => {
    const cat = await lockCategory(tx, restaurantId, categoryId);
    const live = await tx.product.count({ where: { categoryId, restaurantId, archivedAt: null } });
    let moved = 0;
    if (live > 0) {
      if (!reassignTo) fail(409, 'CATEGORY_NOT_EMPTY');
      if (reassignTo === categoryId) fail(422, 'INVALID_CATEGORY');
      const target = reassignTo === 'none' ? null : reassignTo!;
      if (target) await lockCategory(tx, restaurantId, target).catch(() => fail(422, 'INVALID_CATEGORY'));
      moved = (await tx.product.updateMany({ where: { categoryId, restaurantId, archivedAt: null },
        data: { categoryId: target, version: { increment: 1 } } })).count;
    }
    await tx.product.updateMany({ where: { categoryId, restaurantId }, data: { categoryId: null } }); // archived leftovers
    await tx.category.delete({ where: { id: categoryId } });
    await event(tx, restaurantId, sessionId, 'CATEGORY', categoryId, 'CATEGORY_DELETED',
      { name: cat.name, position: cat.position }, { movedProducts: moved, reassignTo: reassignTo ?? null });
  }));
}
