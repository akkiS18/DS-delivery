import { db } from '../lib/db.js';

// Idempotent local test fixture for the Telegram + Android integration run.
// Usage: npm run test:setup -- <restaurant-slug> <staff-telegram-id> <taxi-operator-telegram-id> [mock-card-last4]
// It refuses to run unless the database name contains "test". It never touches payments or sends Telegram messages.
const [, , slug, staffId, taxiOperatorId, cardArg] = process.argv;
const ID = /^\d{5,20}$/;
if (!slug || !staffId || !taxiOperatorId || !ID.test(staffId) || !ID.test(taxiOperatorId)) {
  console.error('Foydalanish: npm run test:setup -- <restaurant-slug> <staff-telegram-id> <taxi-operator-telegram-id> [mock-card-last4]');
  process.exit(1);
}
const last4 = cardArg ?? '9099';
if (!/^\d{4}$/.test(last4)) { console.error('Karta last4 4 ta raqam bo‘lsin'); process.exit(1); }

try {
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  if (!/test/i.test(name)) throw new Error(`Xavfsizlik: baza nomi "${name}" ichida "test" yo‘q. To‘xtatildi.`);
  console.log(`[SETUP] database = ${name}`);

  const restaurant = await db.restaurant.findUnique({ where: { slug } });
  if (!restaurant) throw new Error(`Restoran topilmadi: ${slug}`);

  const staffOwner = await db.restaurant.findUnique({ where: { staffTelegramUserId: staffId } });
  if (staffOwner && staffOwner.id !== restaurant.id) throw new Error(`Bu staff ID ${staffOwner.slug} restoraniga bog‘langan`);
  await db.restaurant.update({ where: { id: restaurant.id }, data: {
    staffTelegramUserId: staffId, staffLinkedAt: restaurant.staffTelegramUserId === staffId ? restaurant.staffLinkedAt ?? new Date() : new Date(),
    isActive: true, pickupAddress: restaurant.pickupAddress ?? 'TEST: olib ketish manzili', pickupPhone: restaurant.pickupPhone ?? '+998900000000',
  } });
  console.log(`[SETUP] staff linked: ${restaurant.slug}`);

  const category = await db.category.findFirst({ where: { restaurantId: restaurant.id } })
    ?? await db.category.create({ data: { restaurantId: restaurant.id, name: 'Taomlar', position: 1 } });
  const products = await db.product.count({ where: { restaurantId: restaurant.id, isAvailable: true } });
  if (!products) {
    await db.product.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: 'Test burger', priceSom: 21000 } });
    console.log('[SETUP] created product "Test burger" (21 000 so‘m)');
  }

  const card = await db.card.findUnique({ where: { last4 } });
  if (card && (card.restaurantId !== restaurant.id || !card.isTest)) throw new Error(`Karta ***${last4} boshqa restoranga yoki real kartaga tegishli`);
  if (!card) await db.card.create({ data: { last4, restaurantId: restaurant.id, isTest: true, label: 'MOCK' } });
  else if (!card.active) await db.card.update({ where: { id: card.id }, data: { active: true } });
  console.log(`[SETUP] MOCK card ***${last4} ready (test card, no real money)`);

  const taxiName = 'Sinov taksi (TEST)';
  const taxiOwner = await db.taxiCompany.findUnique({ where: { operatorTelegramUserId: taxiOperatorId } });
  if (taxiOwner && taxiOwner.name !== taxiName) throw new Error(`Bu operator ID ${taxiOwner.name} kompaniyasiga biriktirilgan`);
  await db.taxiCompany.upsert({
    where: { name: taxiName },
    update: { isActive: true, operatorTelegramUserId: taxiOperatorId, operatorLinkedAt: new Date() },
    create: { name: taxiName, isActive: true, operatorTelegramUserId: taxiOperatorId, operatorLinkedAt: new Date() },
  });
  console.log('[SETUP] taxi operator linked to "Sinov taksi (TEST)"');
  console.log('[SETUP] Done. Each Telegram account must send /start to the test bot once before it can receive messages.');
} catch (err) {
  console.error('[SETUP FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
