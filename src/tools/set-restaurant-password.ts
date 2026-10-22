import { db } from '../lib/db.js';
import { setRestaurantPassword } from '../modules/restaurant-auth/service.js';

// Explicit, local, operator-run provisioning of a restaurant's shared API password.
// Never invoked automatically, never seeds anything, and never overwrites without --replace.
//   npm run restaurant:password -- <restaurant-slug> [--replace]
// The password is read from a hidden prompt (or RESTAURANT_PASSWORD for scripted use). It is never a CLI argument,
// is never printed, and only its Argon2id hash is stored.
const args = process.argv.slice(2);
const replace = args.includes('--replace');
const positional = args.filter(a => !a.startsWith('--'));
const unknown = args.filter(a => a.startsWith('--') && a !== '--replace');
const slug = positional[0];
if (!slug || positional.length !== 1 || unknown.length) {
  console.error('Foydalanish: npm run restaurant:password -- <restaurant-slug> [--replace]');
  process.exit(1);
}

function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('Interaktiv terminal kerak (yoki RESTAURANT_PASSWORD o‘zgaruvchisi).')); return; }
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n'); resolve(value); return;
        }
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); reject(new Error('Bekor qilindi.')); return; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  let password = process.env.RESTAURANT_PASSWORD;
  if (!password) {
    password = await hiddenPrompt('Yangi parol: ');
    if (password !== await hiddenPrompt('Parolni takrorlang: ')) throw new Error('Parollar mos kelmadi.');
  }
  const { created } = await setRestaurantPassword({ slug, password, replace });
  console.log(created
    ? `[RESTAURANT PASSWORD SET] ${slug}: yangi kirish ma'lumoti yaratildi.`
    : `[RESTAURANT PASSWORD REPLACED] ${slug}: parol almashtirildi, barcha sessiyalar bekor qilindi.`);
} catch (err) {
  console.error('[RESTAURANT PASSWORD FAILED]', err instanceof Error ? err.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
