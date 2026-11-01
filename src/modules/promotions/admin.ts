import { db } from '../../lib/db.js';
import { audit, needAdmin, publicBanners, setBannerImage } from './service.js';

// The DS Admin app works with ids (the Telegram /aksiya command works with short codes). Every change is audited; nothing here deletes history
// (orders keep their lines).
const TITLE_MAX = 60;
const cleanTitle = (t: string): string => {
  const s = t.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > TITLE_MAX) throw new Error('NOM_NOTOGRI');
  return s;
};
const auditBanner = (adminId: string, action: string, id: string, details: Record<string, unknown>) =>
  db.adminAuditEvent.create({ data: { actorId: adminId, action, targetType: 'Banner', targetId: id, details: details as never } });

/** Everything the app's "Aksiya" screen shows: promotions with their dishes (and the restaurant's other dishes to pick from), slides, restaurants. */
export async function adminPromoOverview(adminId: string, now = new Date()) {
  needAdmin(adminId);
  const [promos, banners, restaurants, live] = await Promise.all([
    db.promotion.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, isActive: true, maxFreePerOrder: true, restaurantId: true, restaurant: { select: { name: true } }, products: { select: { productId: true } } },
    }),
    db.banner.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, position: true, isActive: true, endsAt: true, restaurantId: true, promotionId: true, restaurant: { select: { name: true } }, promotion: { select: { title: true } }, image: { select: { version: true } } },
    }),
    db.restaurant.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    publicBanners(now),
  ]);
  const liveIds = new Set(live.map(b => b.id));
  const dishes = await db.product.findMany({
    where: { restaurantId: { in: [...new Set(promos.map(p => p.restaurantId))] }, archivedAt: null, isPackaging: false },
    orderBy: [{ category: { position: 'asc' } }, { position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, priceSom: true, restaurantId: true, isAvailable: true, category: { select: { name: true } } },
  });
  return {
    promotions: promos.map(p => ({
      id: p.id, title: p.title, isActive: p.isActive, maxFreePerOrder: p.maxFreePerOrder, restaurantId: p.restaurantId, restaurantName: p.restaurant.name,
      productIds: p.products.map(x => x.productId),
      dishes: dishes.filter(d => d.restaurantId === p.restaurantId).map(d => ({ id: d.id, name: d.name, priceSom: d.priceSom, category: d.category?.name ?? null, isAvailable: d.isAvailable })),
    })),
    banners: banners.map(b => ({
      id: b.id, title: b.title, position: b.position, isActive: b.isActive, endsAt: b.endsAt?.toISOString() ?? null, restaurantId: b.restaurantId, restaurantName: b.restaurant?.name ?? null,
      promotionId: b.promotionId, promotionTitle: b.promotion?.title ?? null, hasImage: b.image !== null, imageVersion: b.image?.version ?? null,
      /** True while customers see it right now (on, picture set, dates ok, its promotion on). */
      live: liveIds.has(b.id),
    })),
    restaurants,
  };
}

export async function createPromotion(adminId: string, input: { restaurantId: string; title: string }): Promise<{ id: string }> {
  needAdmin(adminId);
  const title = cleanTitle(input.title);
  const r = await db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true } });
  if (!r) throw new Error('RESTORAN_TOPILMADI');
  const p = await db.promotion.create({ data: { restaurantId: r.id, title }, select: { id: true } });
  await audit(adminId, 'PROMOTION_CREATED', p.id, { title });
  return p;
}

export interface PromotionPatch { isActive?: boolean; maxFreePerOrder?: number | null; productIds?: string[]; title?: string }
/** Several changes together are applied in one transaction. Switching ON needs at least one dish. */
export async function updatePromotion(adminId: string, id: string, patch: PromotionPatch): Promise<void> {
  needAdmin(adminId);
  const p = await db.promotion.findUnique({ where: { id }, select: { id: true, restaurantId: true, title: true, products: { select: { productId: true } } } });
  if (!p) throw new Error('AKSIYA_TOPILMADI');
  let productIds = p.products.map(x => x.productId);
  if (patch.productIds) {
    const ids = [...new Set(patch.productIds)];
    const ok = await db.product.count({ where: { id: { in: ids }, restaurantId: p.restaurantId, archivedAt: null, isPackaging: false } });
    if (ok !== ids.length) throw new Error('TAOM_TOPILMADI');
    productIds = ids;
  }
  if (patch.isActive === true && productIds.length === 0) throw new Error('AKSIYADA_TAOM_YOQ');
  if (patch.maxFreePerOrder !== undefined && patch.maxFreePerOrder !== null && (!Number.isInteger(patch.maxFreePerOrder) || patch.maxFreePerOrder < 1 || patch.maxFreePerOrder > 100)) throw new Error('SON_NOTOGRI');
  const title = patch.title !== undefined ? cleanTitle(patch.title) : undefined;
  await db.$transaction(async tx => {
    if (patch.productIds) {
      await tx.promotionProduct.deleteMany({ where: { promotionId: id } });
      await tx.promotionProduct.createMany({ data: productIds.map(productId => ({ promotionId: id, productId })) });
    }
    await tx.promotion.update({ where: { id }, data: {
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.maxFreePerOrder !== undefined ? { maxFreePerOrder: patch.maxFreePerOrder } : {}),
      ...(title !== undefined ? { title } : {}),
    } });
    await tx.adminAuditEvent.create({ data: { actorId: adminId, action: 'PROMOTION_UPDATED', targetType: 'Promotion', targetId: id, details: { title: p.title, ...patch } as never } });
  });
}

export async function deletePromotion(adminId: string, id: string): Promise<void> {
  needAdmin(adminId);
  const p = await db.promotion.findUnique({ where: { id }, select: { title: true } });
  if (!p) throw new Error('AKSIYA_TOPILMADI');
  // Slides of this promotion lose the link (they would open the restaurant only): switch them off so no dead slide is shown.
  await db.$transaction([
    db.banner.updateMany({ where: { promotionId: id }, data: { isActive: false } }),
    db.promotion.delete({ where: { id } }),
    db.adminAuditEvent.create({ data: { actorId: adminId, action: 'PROMOTION_DELETED', targetType: 'Promotion', targetId: id, details: { title: p.title } } }),
  ]);
}

export interface BannerInput { title: string; restaurantId?: string | null; promotionId?: string | null; position?: number; isActive?: boolean; endsAt?: string | null }
async function checkTargets(i: { restaurantId?: string | null | undefined; promotionId?: string | null | undefined }): Promise<void> {
  if (i.restaurantId && !(await db.restaurant.findUnique({ where: { id: i.restaurantId }, select: { id: true } }))) throw new Error('RESTORAN_TOPILMADI');
  if (i.promotionId && !(await db.promotion.findUnique({ where: { id: i.promotionId }, select: { id: true } }))) throw new Error('AKSIYA_TOPILMADI');
}
const endsAtOf = (s: string | null | undefined): Date | null | undefined => {
  if (s === undefined) return undefined;
  if (s === null) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('SANA_NOTOGRI');
  return d;
};

/** A new slide starts OFF: it has no picture yet and must not show before the administrator checks it. */
export async function createBanner(adminId: string, input: BannerInput): Promise<{ id: string }> {
  needAdmin(adminId);
  const title = cleanTitle(input.title);
  await checkTargets(input);
  const promo = input.promotionId ? await db.promotion.findUnique({ where: { id: input.promotionId }, select: { restaurantId: true } }) : null;
  const last = await db.banner.aggregate({ _max: { position: true } });
  const b = await db.banner.create({
    data: {
      title, isActive: false, position: input.position ?? (last._max.position ?? 0) + 1,
      restaurantId: input.restaurantId ?? promo?.restaurantId ?? null, promotionId: input.promotionId ?? null, endsAt: endsAtOf(input.endsAt) ?? null,
    },
    select: { id: true },
  });
  await auditBanner(adminId, 'BANNER_CREATED', b.id, { title });
  return b;
}

export async function updateBanner(adminId: string, id: string, patch: Partial<BannerInput>): Promise<void> {
  needAdmin(adminId);
  const b = await db.banner.findUnique({ where: { id }, select: { id: true, title: true, image: { select: { version: true } } } });
  if (!b) throw new Error('SLAYD_TOPILMADI');
  await checkTargets(patch);
  if (patch.isActive === true && !b.image) throw new Error('SLAYDDA_RASM_YOQ');
  const endsAt = endsAtOf(patch.endsAt);
  await db.banner.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.restaurantId !== undefined ? { restaurantId: patch.restaurantId } : {}),
      ...(patch.promotionId !== undefined ? { promotionId: patch.promotionId } : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
    },
  });
  await auditBanner(adminId, 'BANNER_UPDATED', id, { title: b.title, ...patch });
}

export async function deleteBanner(adminId: string, id: string): Promise<void> {
  needAdmin(adminId);
  const b = await db.banner.findUnique({ where: { id }, select: { title: true } });
  if (!b) throw new Error('SLAYD_TOPILMADI');
  await db.banner.delete({ where: { id } });
  await auditBanner(adminId, 'BANNER_DELETED', id, { title: b.title });
}

export async function setBannerImageByAdmin(adminId: string, id: string, bytes: Buffer): Promise<number> {
  needAdmin(adminId);
  if (!(await db.banner.findUnique({ where: { id }, select: { id: true } }))) throw new Error('SLAYD_TOPILMADI');
  const version = await setBannerImage(id, bytes);
  await auditBanner(adminId, 'BANNER_IMAGE_SET', id, { bytes: bytes.length, version });
  return version;
}

/** The picture for the administrator's own preview (works for an off slide too). */
export async function readBannerImageForAdmin(adminId: string, id: string): Promise<{ mime: string; data: Buffer } | null> {
  needAdmin(adminId);
  const row = await db.bannerImage.findUnique({ where: { bannerId: id }, select: { mime: true, data: true } });
  return row ? { mime: row.mime, data: Buffer.from(row.data) } : null;
}
