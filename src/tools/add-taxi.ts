import { db } from '../lib/db.js';
const companyName = process.argv.slice(2).join(' ').trim();
if (companyName.length < 2 || companyName.length > 80) {
  console.error('Foydalanish: npm run taxi:add -- "Ikkinchi sinov taksi"');
  process.exit(1);
}
try {
  const result = await db.taxiCompany.upsert({
    where: { name: companyName },
    update: { isActive: true }, create: { name: companyName, isActive: true },
  });
  console.log(`[TAXI COMPANY] ${result.name} | ID: ${result.id}`);
} catch (err) {
  console.error('[TAXI ADD ERROR]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
