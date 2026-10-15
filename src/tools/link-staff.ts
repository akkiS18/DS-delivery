import { db } from '../lib/db.js';

// Restricted local CLI only, not a publicly exposed endpoint. Do not expose to bot users.
const [, , slug, telegramId] = process.argv;
if (!slug || !telegramId || !/^\d{1,20}$/.test(telegramId)) {
  console.error('Foydalanish: npm run staff:link -- <restaurant-slug> <telegram-user-id>');
  process.exit(1);
}
try {
  const restaurant = await db.restaurant.findUnique({ where: { slug } });
  if (!restaurant) throw new Error(`Restoran topilmadi: ${slug}`);
  const existing = await db.restaurant.findUnique({ where: { staffTelegramUserId: telegramId } });
  if (existing && existing.id !== restaurant.id) throw new Error(`Bu Telegram ID allaqachon ${existing.slug} restoraniga bog‘langan.`);
  await db.restaurant.update({ where: { id: restaurant.id }, data: { staffTelegramUserId: telegramId, staffLinkedAt: new Date() } });
  console.log(`[STAFF LINKED] ${restaurant.name} -> Telegram ID ${telegramId}`);
  console.log('Mas’ul xodim botda /start yuborgan va /staff buyrug‘ini ishlatgan bo‘lishi kerak.');
} catch (err) {
  console.error('[STAFF LINK FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
