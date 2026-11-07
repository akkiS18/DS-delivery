import { createHash } from 'node:crypto';
import { db } from '../../lib/db.js';
import { sniffImage } from '../refunds/receipts.js';
import { isSupportAdmin } from '../support/service.js';

/** Banners of the Mini App home carousel and the 1+1 promotions behind them (owner decisions 2026-11-01). */

export const bannerImageUrl = (id: string, version: number): string => `/api/v1/miniapp/banners/${id}/image?v=${version}`;

/**
 * The slides the customer sees now: the banner is on, inside its dates, has a picture, and - when it belongs to a promotion - that promotion is on
 * and has a dish the customer can order. `target` is where a tap goes: the restaurant (and its "Chegirmalar" group for a promotion).
 */
export async function publicBanners(now = new Date()) {
  const rows = await db.banner.findMany({
    where: {
      isActive: true, image: { isNot: null },
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 10,
    select: {
      id: true, title: true, restaurantId: true, promotionId: true, image: { select: { version: true } },
      promotion: { select: { isActive: true, restaurantId: true, restaurant: { select: { isActive: true } }, products: { where: { product: { isAvailable: true, archivedAt: null } }, select: { productId: true }, take: 1 } } },
      restaurant: { select: { isActive: true } },
    },
  });
  // A plain slide of a restaurant (not a 1+1 promotion) opens that restaurant's offers group when it has one (owner request 2026-11-07).
  const plainRestaurants = [...new Set(rows.filter(b => !b.promotionId && b.restaurantId).map(b => b.restaurantId!))];
  const dealGroups = plainRestaurants.length === 0 ? [] : await db.category.findMany({
    where: { restaurantId: { in: plainRestaurants }, name: { in: DEAL_GROUP_NAMES, mode: 'insensitive' }, products: { some: { archivedAt: null } } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, restaurantId: true },
  });
  const dealGroupOf = new Map<string, string>();
  for (const g of dealGroups) if (!dealGroupOf.has(g.restaurantId)) dealGroupOf.set(g.restaurantId, g.id);
  return rows.flatMap(b => {
    if (b.promotionId && (!b.promotion?.isActive || !b.promotion.restaurant.isActive || b.promotion.products.length === 0)) return [];
    if (!b.promotionId && b.restaurantId && !b.restaurant?.isActive) return [];
    const restaurantId = b.promotion?.restaurantId ?? b.restaurantId ?? null;
    const categoryId = !b.promotionId && restaurantId ? dealGroupOf.get(restaurantId) : undefined;
    return [{ id: b.id, title: b.title, imageUrl: bannerImageUrl(b.id, b.image!.version), target: restaurantId ? { restaurantId, promo: b.promotionId !== null, ...(categoryId ? { categoryId } : {}) } : null }];
  });
}

/** The names a restaurant gives its group of special offers (the Sifat Food one is "AKSIYA"). */
const DEAL_GROUP_NAMES = ['AKSIYA', 'AKSIYALAR', 'Акция', 'Акции'];

export async function readBannerImage(bannerId: string): Promise<{ mime: string; data: Buffer; sha256: string } | null> {
  const row = await db.bannerImage.findFirst({ where: { bannerId, banner: { isActive: true } }, select: { mime: true, data: true, sha256: true } });
  return row ? { mime: row.mime, data: Buffer.from(row.data), sha256: row.sha256 } : null;
}

export const BANNER_IMAGE_MAX_BYTES = 1024 * 1024;
/** Stores (or replaces) a banner picture. The type is decided by the bytes; 1 KB .. 1 MB (pictures are shrunk before they get here). */
export async function setBannerImage(bannerId: string, bytes: Buffer): Promise<number> {
  const mime = sniffImage(bytes);
  if (!mime || bytes.length < 1024 || bytes.length > BANNER_IMAGE_MAX_BYTES) throw new Error('RASM_NOTOGRI');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const data = Uint8Array.from(bytes);
  const existing = await db.bannerImage.findUnique({ where: { bannerId }, select: { version: true } });
  const version = (existing?.version ?? 0) + 1;
  await db.bannerImage.upsert({ where: { bannerId }, create: { bannerId, mime, data, sha256, version }, update: { mime, data, sha256, version } });
  return version;
}

// ------------------------------------------------------------------------------------------------ administrator tools (Telegram /aksiya)
export const needAdmin = (adminId: string): void => { if (!isSupportAdmin(adminId)) throw new Error('ADMIN_RUXSAT_YOQ'); };
/** Short, typeable reference of a promotion: the last 6 characters of its id. */
export const promoRef = (id: string): string => id.slice(-6);

export async function listPromotionsForAdmin(adminId: string) {
  needAdmin(adminId);
  const rows = await db.promotion.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, isActive: true, maxFreePerOrder: true, restaurant: { select: { slug: true, name: true } }, products: { select: { product: { select: { name: true, priceSom: true } } } }, banners: { select: { isActive: true } } },
  });
  return rows.map(r => ({
    ref: promoRef(r.id), title: r.title, isActive: r.isActive, maxFreePerOrder: r.maxFreePerOrder, restaurant: r.restaurant.name, slug: r.restaurant.slug,
    products: r.products.map(p => `${p.product.name} (${p.product.priceSom})`).sort(), bannerOn: r.banners.some(b => b.isActive),
  }));
}

async function promoByRef(ref: string) {
  const r = ref.trim().toLowerCase();
  if (r.length < 4) throw new Error('AKSIYA_TOPILMADI');
  const rows = await db.promotion.findMany({ where: { id: { endsWith: r } }, select: { id: true, restaurantId: true, title: true, isActive: true, _count: { select: { products: true } } } });
  if (rows.length !== 1) throw new Error('AKSIYA_TOPILMADI');
  return rows[0]!;
}

export async function audit(adminId: string, action: string, id: string, details: Record<string, unknown>): Promise<void> {
  await db.adminAuditEvent.create({ data: { actorId: adminId, action, targetType: 'Promotion', targetId: id, details: details as never } });
}

/** Switches a promotion on or off. It cannot be switched on without products (it would do nothing and the "Chegirmalar" group would be empty). */
export async function setPromotionActive(adminId: string, ref: string, on: boolean): Promise<{ title: string; isActive: boolean }> {
  needAdmin(adminId);
  const p = await promoByRef(ref);
  if (on && p._count.products === 0) throw new Error('AKSIYADA_TAOM_YOQ');
  await db.promotion.update({ where: { id: p.id }, data: { isActive: on } });
  await audit(adminId, on ? 'PROMOTION_ON' : 'PROMOTION_OFF', p.id, { title: p.title });
  return { title: p.title, isActive: on };
}

/** Replaces the promotion's products with the restaurant's dishes of exactly these names (case-insensitive). Unknown names are reported, nothing is half-applied. */
export async function setPromotionProducts(adminId: string, ref: string, names: string[]): Promise<{ title: string; products: string[] }> {
  needAdmin(adminId);
  const p = await promoByRef(ref);
  const wanted = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  if (wanted.length === 0 || wanted.length > 40) throw new Error('TAOM_NOMLARI_NOTOGRI');
  const dishes = await db.product.findMany({ where: { restaurantId: p.restaurantId, archivedAt: null, isPackaging: false }, select: { id: true, name: true } });
  const byName = new Map(dishes.map(d => [d.name.trim().toLowerCase(), d]));
  const missing = wanted.filter(n => !byName.has(n.toLowerCase()));
  if (missing.length) throw Object.assign(new Error('TAOM_TOPILMADI'), { missing });
  const chosen = wanted.map(n => byName.get(n.toLowerCase())!);
  await db.$transaction([
    db.promotionProduct.deleteMany({ where: { promotionId: p.id } }),
    db.promotionProduct.createMany({ data: chosen.map(d => ({ promotionId: p.id, productId: d.id })) }),
  ]);
  await audit(adminId, 'PROMOTION_PRODUCTS_SET', p.id, { products: chosen.map(d => d.name) });
  return { title: p.title, products: chosen.map(d => d.name) };
}

/** 0 removes the cap. */
export async function setPromotionCap(adminId: string, ref: string, cap: number): Promise<{ title: string; cap: number | null }> {
  needAdmin(adminId);
  if (!Number.isInteger(cap) || cap < 0 || cap > 100) throw new Error('SON_NOTOGRI');
  const p = await promoByRef(ref);
  await db.promotion.update({ where: { id: p.id }, data: { maxFreePerOrder: cap === 0 ? null : cap } });
  await audit(adminId, 'PROMOTION_CAP_SET', p.id, { cap: cap === 0 ? null : cap });
  return { title: p.title, cap: cap === 0 ? null : cap };
}
