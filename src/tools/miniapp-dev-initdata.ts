/**
 * Prints a correctly SIGNED Telegram initData string for local development of the Mini App in a desktop browser.
 *   npm run miniapp:dev-initdata -- <telegramUserId> [firstName]
 * Then in the browser console (vite dev only):  localStorage.setItem('ds.dev.initData', '<printed string>')
 * Refuses to run in production. The string is only as powerful as BOT_TOKEN, which never leaves this machine.
 */
import { signInitData } from '../modules/miniapp/auth.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to sign initData in production.');
  process.exit(1);
}
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is not set (run through the npm script so .env is loaded).');
  process.exit(1);
}
const [id, firstName = 'Dev'] = process.argv.slice(2);
if (!id || !/^\d{1,15}$/.test(id)) {
  console.error('Usage: npm run miniapp:dev-initdata -- <telegramUserId> [firstName]');
  process.exit(1);
}
const user = JSON.stringify({ id: Number(id), first_name: firstName, language_code: 'uz' });
console.log(signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)), query_id: `dev-${Date.now()}` }, token));
