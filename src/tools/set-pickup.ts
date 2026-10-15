import { db } from '../lib/db.js';
// Usage: npm run restaurant:pickup -- demo-restoran "+998901234567" "Ziyovuddin markazi, 1-uy"
const [, , slug, phone, ...addressParts] = process.argv;
const address = addressParts.join(' ').trim();
if (!slug || !phone || !/^\+998\d{9}$/.test(phone) || address.length < 5 || address.length > 500) {
  console.error('Foydalanish: npm run restaurant:pickup -- <slug> +998901234567 "Restoran manzili"');
  process.exit(1);
}
try {
  const result = await db.restaurant.update({ where: { slug }, data: { pickupAddress: address, pickupPhone: phone } });
  console.log(`[PICKUP SAVED] ${result.name} -> ${address}`);
} catch (err) {
  console.error('[PICKUP FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
