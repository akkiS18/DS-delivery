import { createHash } from 'node:crypto';
import { db } from '../../lib/db.js';
import { sniffImage, type ReceiptMime } from '../refunds/receipts.js';
import { CatalogError } from './service.js';

/**
 * Dish photos (owner request 2026-10-27). The restaurant app shrinks the picked photo and sends the raw bytes; the type is decided by the file's
 * magic bytes (the sender's claims are never trusted). The bytes live in the database (ProductImage) so the normal backup covers them.
 * Tenant isolation lives in the WHERE clause: another restaurant's dish is simply "not found".
 */
export const PRODUCT_IMAGE_MIN_BYTES = 1024;
export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export const productImageUrl = (productId: string, version: number): string => `/api/v1/miniapp/products/${productId}/image?v=${version}`;

/** Pure. Throws a 400 RASM_NOTOGRI. */
export function validateProductImage(buf: unknown): { mime: ReceiptMime; sha256: string } {
  if (!Buffer.isBuffer(buf) || buf.length < PRODUCT_IMAGE_MIN_BYTES || buf.length > PRODUCT_IMAGE_MAX_BYTES) throw new CatalogError(400, 'RASM_NOTOGRI');
  const mime = sniffImage(buf);
  if (!mime) throw new CatalogError(400, 'RASM_NOTOGRI');
  return { mime, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Stores (or replaces) the photo of one of THIS restaurant's dishes. Returns the new version; the dish's own version is not touched. */
export async function setProductImage(restaurantId: string, sessionId: string, productId: string, bytes: Buffer): Promise<{ version: number; imageUrl: string }> {
  const { mime, sha256 } = validateProductImage(bytes);
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; archivedAt: Date | null }>>`SELECT "id", "archivedAt" FROM "Product" WHERE "id" = ${productId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
    if (!rows.length) throw new CatalogError(404, 'NOT_FOUND');
    if (rows[0]!.archivedAt) throw new CatalogError(409, 'ARCHIVED');
    const existing = await tx.productImage.findUnique({ where: { productId }, select: { version: true } });
    const version = (existing?.version ?? 0) + 1;
    const data = Uint8Array.from(bytes); // a plain ArrayBuffer-backed copy, as the Bytes column type requires
    await tx.productImage.upsert({ where: { productId }, create: { productId, mime, data, sha256, version }, update: { mime, data, sha256, version } });
    await tx.catalogEvent.create({ data: { restaurantId, entity: 'PRODUCT', entityId: productId, action: 'PRODUCT_IMAGE_SET', actorSessionId: sessionId, after: { bytes: bytes.length, version } } });
    return { version, imageUrl: productImageUrl(productId, version) };
  });
}

/** Removes the photo. Idempotent: no photo (or a foreign dish) is the same 204 and writes nothing. */
export async function deleteProductImage(restaurantId: string, sessionId: string, productId: string): Promise<void> {
  await db.$transaction(async tx => {
    const removed = await tx.productImage.deleteMany({ where: { productId, product: { restaurantId } } });
    if (removed.count > 0) await tx.catalogEvent.create({ data: { restaurantId, entity: 'PRODUCT', entityId: productId, action: 'PRODUCT_IMAGE_REMOVED', actorSessionId: sessionId } });
  });
}

/** For the public image URL: only an active restaurant's live (not archived) dish. */
export async function readProductImage(productId: string): Promise<{ mime: string; data: Buffer; sha256: string } | null> {
  const row = await db.productImage.findFirst({ where: { productId, product: { archivedAt: null, restaurant: { isActive: true } } }, select: { mime: true, data: true, sha256: true } });
  return row ? { mime: row.mime, data: Buffer.from(row.data), sha256: row.sha256 } : null;
}
