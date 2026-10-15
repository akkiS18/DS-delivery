import { db } from '../lib/db.js';

// Usage: npm run taxi:link -- "Sinov taksi (TEST)" 123456789
const [, , companyName, telegramId] = process.argv;
if (!companyName?.trim() || !telegramId || !/^\d{1,20}$/.test(telegramId)) {
  console.error('Foydalanish: npm run taxi:link -- "<taxi-company-name>" <telegram-user-id>');
  process.exit(1);
}
try {
  const company = await db.taxiCompany.findUnique({ where: { name: companyName } });
  if (!company) throw new Error(`Kompaniya topilmadi: ${companyName}`);
  const other = await db.taxiCompany.findUnique({ where: { operatorTelegramUserId: telegramId } });
  if (other && other.id !== company.id) throw new Error(`Bu Telegram ID ${other.name} kompaniyasiga biriktirilgan`);
  await db.taxiCompany.update({ where: { id: company.id }, data: {
    operatorTelegramUserId: telegramId, operatorLinkedAt: new Date(),
  } });
  console.log(`[TAXI LINKED] ${company.name} -> ${telegramId}. Operator botda /start va /taxi yuborsin.`);
} catch (err) {
  console.error('[TAXI LINK FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
