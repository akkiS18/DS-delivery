import readline from 'node:readline/promises';
import fs from 'node:fs/promises';
import { Writable } from 'node:stream';
import { humoSessionFile, isHumoSlot } from '../modules/payment/humo-telegram.js';

// One-time interactive login of the Telegram account that receives the Humocard bot's messages. Run it in YOUR OWN terminal (not through an
// assistant): it asks for the phone, the code Telegram sends and the 2-step password, and writes the resulting session to a private file.
// The session is a full login of that account: it is never printed, never committed (humo-session.txt is git-ignored).
// `npm run humo:login` = the original account; `npm run humo:login -- 2` = the second account (HUMO_TG_API_ID_2 / _HASH_2, file humo-session-2.txt), up to 4.
const slotArg = process.argv[2] ?? '';
if (!isHumoSlot(slotArg)) { console.error('Hisob raqami 2, 3 yoki 4 bo‘lishi kerak (asosiy hisob uchun hech narsa yozmang).'); process.exit(1); }
const slot = slotArg;
const suffix = slot ? `_${slot}` : '';
const apiId = Number(process.env[`HUMO_TG_API_ID${suffix}`]);
const apiHash = process.env[`HUMO_TG_API_HASH${suffix}`]?.trim() ?? '';
if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[0-9a-f]{32}$/i.test(apiHash)) {
  console.error(`Avval .env ga HUMO_TG_API_ID${suffix} va HUMO_TG_API_HASH${suffix} ni yozing (my.telegram.org dan, shu akkaunt bilan).`);
  process.exit(1);
}

type Dialog = { name?: string; entity?: { bot?: boolean; username?: string; id?: { toString(): string } } };
type Client = {
  start(p: Record<string, unknown>): Promise<unknown>;
  session: { save(): string };
  getDialogs(p: { limit: number }): Promise<Dialog[]>;
  setLogLevel(level: string): void;
  disconnect(): Promise<unknown>;
};

// Everything typed is echoed through this stream except while `muted` (the password).
let muted = false;
const echo = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
const rl = readline.createInterface({ input: process.stdin, output: echo, terminal: true });
async function secret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  try { return await rl.question(''); } finally { muted = false; process.stdout.write('\n'); }
}

const pkg = 'telegram';
const gram = await import(pkg) as { TelegramClient: new (s: unknown, id: number, hash: string, p: Record<string, unknown>) => Client };
const sessions = await import(`${pkg}/sessions/index.js`) as { StringSession: new (s: string) => unknown };
const client = new gram.TelegramClient(new sessions.StringSession(''), apiId, apiHash, { connectionRetries: 5 });
client.setLogLevel('error');
try {
  await client.start({
    phoneNumber: () => rl.question('Telegram raqami (+998...): '),
    phoneCode: () => rl.question('Telegram yuborgan kod: '),
    password: () => secret('2 bosqichli parol (bo‘lmasa Enter): '),
    onError: (err: Error) => console.error('Xato:', err.message),
  });
  const file = humoSessionFile(slot);
  await fs.writeFile(file, client.session.save(), { mode: 0o600 });
  console.log(`\nKirish muvaffaqiyatli. Sessiya "${file}" fayliga yozildi (yashirin; gitga tushmaydi, hech kimga bermang).`);
  const bots = (await client.getDialogs({ limit: 200 })).filter(d => d.entity?.bot && d.entity.username);
  console.log('\nAkkauntingizdagi botlar (HUMO_TG_BOT uchun Humocard botning username‘ini tanlang):');
  for (const d of bots) console.log(`  @${d.entity!.username}  (${d.name ?? ''})`);
  if (!bots.length) console.log('  (bot chatlari topilmadi)');
} catch (err) {
  console.error('[HUMO LOGIN FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rl.close();
  try { await client.disconnect(); } catch { /* ignore */ }
}
process.exit(process.exitCode ?? 0);
