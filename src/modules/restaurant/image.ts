import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { sniffImage, type ReceiptMime } from '../refunds/receipts.js';
import { isSupportAdmin } from '../support/service.js';
import { logoOnWide } from '../images/logo-wide.js';

/**
 * The restaurant's photo on its card in the customer apps. Set by a platform administrator from Telegram (when adding the restaurant, or later
 * with /restaurantphoto). The type is decided by the file's magic bytes (the sender's claims are never trusted); the bytes live in the database
 * so the normal backup covers them. Telegram already shrinks a "photo" to at most 1280 px, so no image library is needed.
 */
export const IMAGE_MIN_BYTES = 1024;
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
type Tx = Prisma.TransactionClient | typeof db;

/** Pure. Throws RASM_NOTOGRI. */
export function validateRestaurantImage(buf: unknown): { mime: ReceiptMime; sha256: string } {
  if (!Buffer.isBuffer(buf) || buf.length < IMAGE_MIN_BYTES || buf.length > IMAGE_MAX_BYTES) throw new Error('RASM_NOTOGRI');
  const mime = sniffImage(buf);
  if (!mime) throw new Error('RASM_NOTOGRI');
  return { mime, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Stores (or replaces) the photo of the restaurant with this slug. `null` when there is no such restaurant. Audited; the bytes are not. */
export async function setRestaurantImage(input: { adminId: string; slug: string; bytes: Buffer }, tx: Tx = db): Promise<{ id: string; name: string; version: number } | null> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const { mime, sha256 } = validateRestaurantImage(input.bytes);
  const r = await tx.restaurant.findUnique({ where: { slug: input.slug.trim().toLowerCase() }, select: { id: true, name: true, image: { select: { version: true } } } });
  if (!r) return null;
  const version = (r.image?.version ?? 0) + 1;
  const data = Uint8Array.from(input.bytes); // a plain ArrayBuffer-backed copy, as the Bytes column type requires
  await tx.restaurantImage.upsert({
    where: { restaurantId: r.id },
    create: { restaurantId: r.id, mime, data, sha256, version },
    update: { mime, data, sha256, version },
  });
  await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'RESTAURANT_IMAGE_SET', targetType: 'Restaurant', targetId: r.id, details: { bytes: input.bytes.length, version } } });
  return { id: r.id, name: r.name, version };
}

/** Widths up to this are the app's small square frames (search / closed rows, order screen logo: ?w=160). */
export const LOGO_MAX_WIDTH = 320;

/** Pure. A square frame asks for a small copy; a request without a width (or a wide one) gets the main picture. */
export const wantsLogo = (width: number | null): boolean => width !== null && width <= LOGO_MAX_WIDTH;

export type PictureKind = 'image' | 'logo' | 'logoWide';
/**
 * Pure. Which picture one frame gets (owner requests 2026-11-22). Without a logo: always the main picture, as before.
 * With a logo: small squares (?w<=320) the logo; the menu header (?slot=cover) the main picture (the wide icon background);
 * other sized requests (home card, ?w=640) the logo on its own background colour (logo-wide.ts); a request without a width
 * (staff apps showing the stored photo) the main picture.
 */
export function pickPicture(width: number | null, slot: string | null, hasLogo: boolean): PictureKind {
  if (!hasLogo || slot === 'cover' || width === null) return 'image';
  return wantsLogo(width) ? 'logo' : 'logoWide';
}

export async function readRestaurantImage(restaurantId: string, width: number | null = null, slot: string | null = null): Promise<{ mime: string; data: Buffer; sha256: string } | null> {
  const logo = width === null || slot === 'cover' ? null
    : await db.restaurantLogo.findFirst({ where: { restaurantId, restaurant: { isActive: true } }, select: { mime: true, data: true, sha256: true } });
  const kind = pickPicture(width, slot, logo !== null);
  if (logo && kind === 'logo') return { mime: logo.mime, data: Buffer.from(logo.data), sha256: logo.sha256 };
  if (logo && kind === 'logoWide') {
    const plain = { mime: logo.mime, data: Buffer.from(logo.data), sha256: logo.sha256 };
    return (await logoOnWide(plain)) ?? plain;
  }
  const row = await db.restaurantImage.findFirst({ where: { restaurantId, restaurant: { isActive: true } }, select: { mime: true, data: true, sha256: true } });
  return row ? { mime: row.mime, data: Buffer.from(row.data), sha256: row.sha256 } : null;
}
