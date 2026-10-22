import { db } from '../lib/db.js';

// Explicit, operator-run provisioning of a restaurant row (Stage 8C: there is no admin APK in the pilot). Run it on the server:
//   npm run restaurant:create -- <slug> "<Name>" "<pickup address>" [pickup phone]
// It only creates the restaurant. Then, separately: restaurant:password (login), staff:link (Telegram alerts), restaurant:pickup, and the
// restaurant adds its own payee cards in the app (an administrator approves them in Telegram). Never overwrites an existing restaurant.
const [, , slug, name, pickupAddress, pickupPhone] = process.argv;
if (!slug || !name || !pickupAddress || !/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error('Foydalanish: npm run restaurant:create -- <slug (a-z, 0-9, -)> "<Nomi>" "<olib ketish manzili>" [telefon]');
  process.exit(1);
}
if (pickupPhone && !/^\+?\d{9,15}$/.test(pickupPhone)) {
  console.error('Telefon raqami noto‘g‘ri.');
  process.exit(1);
}
try {
  if (await db.restaurant.findUnique({ where: { slug } })) throw new Error(`Bu slug band: ${slug}`);
  const r = await db.restaurant.create({
    data: { slug, name: name.trim().slice(0, 80), pickupAddress: pickupAddress.trim().slice(0, 200), ...(pickupPhone ? { pickupPhone } : {}) },
  });
  console.log(`[RESTAURANT CREATED] ${r.name} (${r.slug})`);
  console.log(`Keyingi qadam: npm run restaurant:password -- ${r.slug}`);
} catch (err) {
  console.error('[RESTAURANT CREATE FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
