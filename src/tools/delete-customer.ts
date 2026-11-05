import { db } from '../lib/db.js';
import { AccountDeletionError, deleteCustomerAccount } from '../modules/miniapp/account-deletion.js';
// For deletion requests that arrive by e-mail (Google Play policy: a web way to ask must exist).
// Usage: npm run customer:delete -- --phone +998901234567            (dry run: shows who would be deleted)
//        npm run customer:delete -- --telegram 123456789 --apply
//        npm run customer:delete -- --id <customerId> --apply
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const phone = value('--phone'); const telegram = value('--telegram'); const id = value('--id');
if ([phone, telegram, id].filter(Boolean).length !== 1) {
  console.error('Foydalanish: npm run customer:delete -- (--phone +998901234567 | --telegram <id> | --id <customerId>) [--apply]');
  process.exit(1);
}
if (phone && !/^\+998\d{9}$/.test(phone)) { console.error('Telefon +998901234567 ko‘rinishida bo‘lishi kerak.'); process.exit(1); }
if (telegram && !/^\d{1,15}$/.test(telegram)) { console.error('Telegram id raqam bo‘lishi kerak.'); process.exit(1); }
try {
  const found = await db.customer.findMany({
    where: { mergedIntoId: null, ...(id ? { id } : phone ? { phone } : { telegramUserId: telegram }) },
    select: { id: true, displayName: true, phone: true, telegramUserId: true, blockedAt: true, deletedAt: true, _count: { select: { orders: true } } },
  });
  if (!found.length) { console.log('[NOT FOUND] Mos mijoz topilmadi.'); process.exit(0); }
  for (const c of found) {
    console.log(`${c.id}  ${c.displayName ?? '-'}  ${c.phone ?? '-'}  tg:${c.telegramUserId ?? '-'}  orders:${c._count.orders}${c.blockedAt ? '  BLOCKED' : ''}${c.deletedAt ? '  (already deleted)' : ''}`);
    if (!apply) continue;
    try {
      const r = await deleteCustomerAccount(c.id, 'cli:delete-customer');
      console.log('  ->', JSON.stringify(r));
    } catch (err) {
      if (err instanceof AccountDeletionError) { console.error(`  -> REFUSED: ${err.code}`); process.exitCode = 1; } else throw err;
    }
  }
  if (!apply) console.log('\nDry run. Haqiqatan o‘chirish uchun --apply qo‘shing.');
} catch (err) {
  console.error('[DELETE FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
