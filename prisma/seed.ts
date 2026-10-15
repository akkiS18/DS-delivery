import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const restaurant = await db.restaurant.upsert({
    where: { slug: 'demo-restoran' }, update: {},
    create: { slug: 'demo-restoran', name: 'Demo restoran' },
  });
  const category = await db.category.findFirst({ where: { restaurantId: restaurant.id, name: 'Taomlar' } }) ??
    await db.category.create({ data: { restaurantId: restaurant.id, name: 'Taomlar', position: 1 } });
  let product = await db.product.findFirst({ where: { restaurantId: restaurant.id, name: 'Demo burger' } });
  product ??= await db.product.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: 'Demo burger', priceSom: 21000 } });
  await db.taxiCompany.upsert({ where: { name: 'Sinov taksi (TEST)' }, update: {}, create: { name: 'Sinov taksi (TEST)' } });
  const card = await db.card.upsert({
    where: { last4: '9099' }, update: {},
    create: { last4: '9099', restaurantId: restaurant.id, isTest: true, label: 'MOCK' },
  });
  if (card.restaurantId !== restaurant.id || !card.isTest) throw new Error('Demo karta boshqa restorangaga tegishli, seed to‘xtatildi');
  console.log(JSON.stringify({ restaurantId: restaurant.id, restaurantSlug: restaurant.slug, productId: product.id, mockCardLast4: card.last4 }, null, 2));
} finally { await db.$disconnect(); }
