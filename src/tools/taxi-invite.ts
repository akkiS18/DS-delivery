import { db } from '../lib/db.js';
import { createOperatorInvite, INVITE_TTL_HOURS } from '../modules/taxi/linking.js';

// Local administrator CLI. Usage: npm run taxi:invite -- "<taxi-company-name>"
// Prints a one-time operator link code ONCE; only its hash is stored. The operator sends it to the taxi bot (/link CODE).
const companyName = process.argv.slice(2).join(' ').trim();
if (!companyName) {
  console.error('Foydalanish: npm run taxi:invite -- "<taxi-company-name>"');
  process.exit(1);
}
try {
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  const invite = await createOperatorInvite(companyName, 'cli-admin');
  console.log(`[TAXI INVITE] database=${name} company="${invite.companyName}"`);
  console.log(`Ulanish kodi: ${invite.code}`);
  console.log(`Amal qilish muddati: ${INVITE_TTL_HOURS} soat (${invite.expiresAt.toISOString()}), bir marta ishlatiladi.`);
  console.log('Operator taksi botga /link KOD yuboradi. Kodni xavfsiz kanal orqali bering va saqlamang.');
} catch (err) {
  console.error('[TAXI INVITE FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
