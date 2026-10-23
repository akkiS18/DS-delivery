import { randomInt } from 'node:crypto';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { setRestaurantPassword } from '../restaurant-auth/service.js';
import { assertPasswordPolicy } from '../restaurant-auth/password.js';

/**
 * Stage 9: platform administrators add restaurants and hand out logins from Telegram (the same steps the operator CLI tools do on the server).
 * A new restaurant starts PAUSED: its staff sign in, add the menu and a card, and only then switch "Buyurtma qabul qilish" on, so customers
 * never see an empty restaurant. Every step is written to the append-only AdminAuditEvent (never the password).
 */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/l/I
const PASSWORD_LENGTH = 14;

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** "Do‘stlik Cafe №2" -> "dostlik-cafe-2". Always 2-40 characters of a-z, 0-9 and "-" (the rule the login and the tools use). */
export function slugFromName(name: string): string {
  const latin = [...name.toLowerCase()].map(ch => CYRILLIC[ch] ?? ch).join('')
    .replace(/[‘’ʻʼ'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/g, '');
  return latin.length >= 2 ? latin : 'restoran';
}

export function generatePassword(slug: string): string {
  for (;;) {
    const candidate = Array.from({ length: PASSWORD_LENGTH }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
    try { assertPasswordPolicy(candidate, slug); return candidate; } catch { /* e.g. the slug happens to appear inside: draw again */ }
  }
}

const requireAdmin = (adminId: string): void => { if (!isSupportAdmin(adminId)) throw new Error('ADMIN_RUXSAT_YOQ'); };

export interface ProvisionInput { adminId: string; name: string; pickupAddress: string; pickupPhone?: string | undefined }

export async function createRestaurantByAdmin(input: ProvisionInput): Promise<{ slug: string; name: string; password: string }> {
  requireAdmin(input.adminId);
  const name = input.name.trim().slice(0, 80);
  const pickupAddress = input.pickupAddress.trim().slice(0, 200);
  const phone = input.pickupPhone?.trim();
  if (name.length < 2) throw new Error('NOM_QISQA');
  if (pickupAddress.length < 3) throw new Error('MANZIL_QISQA');
  if (phone && !/^\+?\d{9,15}$/.test(phone)) throw new Error('TELEFON_NOTOGRI');

  const base = slugFromName(name);
  let restaurant: { id: string; slug: string } | null = null;
  for (let n = 1; n <= 30 && !restaurant; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    try {
      restaurant = await db.restaurant.create({
        data: { slug, name, pickupAddress, ...(phone ? { pickupPhone: phone } : {}), isPaused: true },
        select: { id: true, slug: true },
      });
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002')) throw err; // slug taken: try the next suffix
    }
  }
  if (!restaurant) throw new Error('SLUG_BAND');

  const password = generatePassword(restaurant.slug);
  await setRestaurantPassword({ slug: restaurant.slug, password });
  await db.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'RESTAURANT_CREATED', targetType: 'Restaurant', targetId: restaurant.id, details: { slug: restaurant.slug } } });
  return { slug: restaurant.slug, name, password };
}

/** A new password for an existing restaurant. All of its signed-in devices are signed out (setRestaurantPassword with replace). */
export async function resetRestaurantPasswordByAdmin(input: { adminId: string; slug: string }): Promise<{ slug: string; name: string; password: string } | null> {
  requireAdmin(input.adminId);
  const slug = input.slug.trim().toLowerCase();
  const restaurant = await db.restaurant.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!restaurant) return null;
  const password = generatePassword(restaurant.slug);
  await setRestaurantPassword({ slug: restaurant.slug, password, replace: true });
  await db.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'RESTAURANT_PASSWORD_RESET', targetType: 'Restaurant', targetId: restaurant.id, details: { slug: restaurant.slug } } });
  return { slug: restaurant.slug, name: restaurant.name, password };
}

export type LinkStaffResult = { result: 'LINKED'; name: string } | { result: 'NOT_FOUND' } | { result: 'TAKEN'; otherSlug: string };

/** Telegram alerts ("new paid order") for a restaurant go to this person. One Telegram account belongs to one restaurant. */
export async function linkStaffByAdmin(input: { adminId: string; slug: string; telegramId: string }): Promise<LinkStaffResult> {
  requireAdmin(input.adminId);
  if (!/^\d{1,20}$/.test(input.telegramId)) throw new Error('TELEGRAM_ID_NOTOGRI');
  const restaurant = await db.restaurant.findUnique({ where: { slug: input.slug.trim().toLowerCase() }, select: { id: true, name: true } });
  if (!restaurant) return { result: 'NOT_FOUND' };
  const other = await db.restaurant.findUnique({ where: { staffTelegramUserId: input.telegramId }, select: { id: true, slug: true } });
  if (other && other.id !== restaurant.id) return { result: 'TAKEN', otherSlug: other.slug };
  await db.restaurant.update({ where: { id: restaurant.id }, data: { staffTelegramUserId: input.telegramId, staffLinkedAt: new Date() } });
  await db.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'RESTAURANT_STAFF_LINKED', targetType: 'Restaurant', targetId: restaurant.id, details: { telegramId: input.telegramId } } });
  return { result: 'LINKED', name: restaurant.name };
}
