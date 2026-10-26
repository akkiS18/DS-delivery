import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';

// Stage 7C-QA, Phase 6: headless-Chromium UI checks of the BUILT Mini App (apps/customer-miniapp/dist) at 320/375/390/430 px.
// No Playwright dependency: a ~60-line Chrome DevTools Protocol client over Node's built-in WebSocket. The real backend runs in-process on
// ds_delivery_test and serves the app at /app/; authentication is a Telegram.WebApp STUB carrying initData signed with a FIXTURE bot token
// (no real token anywhere). Telegram's own SDK script is blocked so it cannot replace the stub.
// NOT covered (cannot be): the real Telegram client, native WebView, iOS/Android software keyboard, safe-area insets, haptics.
// Skips (reported as skipped, never as passed) when no Chromium/Chrome/Edge is installed or the Mini App has not been built.
const BOT_TOKEN = '123456789:AAFakeQaUiTokenLocalOnly_0123456789ab';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.MINIAPP_ORDER_RATE_PER_MINUTE = '500';
delete process.env.BOT_PAYMENT_MODE;
const dist = path.resolve(process.cwd(), 'apps', 'customer-miniapp', 'dist');
process.env.MINIAPP_DIST_DIR = dist;
const operatorTg = String(randomInt(900000000001, 990000000000));
process.env.TAXI_OPERATOR_ALLOWLIST = operatorTg;

function findBrowser(): string | null {
  const home = os.homedir();
  const pw = path.join(home, 'AppData', 'Local', 'ms-playwright');
  const candidates: string[] = [];
  if (existsSync(pw)) for (const d of readdirSync(pw).filter(x => x.startsWith('chromium-'))) candidates.push(path.join(pw, d, 'chrome-win64', 'chrome.exe'));
  candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find(existsSync) ?? null;
}
const browserPath = findBrowser();
const skipReason = !browserPath ? 'no Chromium/Chrome/Edge found' : !existsSync(path.join(dist, 'index.html')) ? 'Mini App not built (npm run miniapp:build)' : false;

// ---------------------------------------------------------------------------------------------- minimal CDP client
class Cdp {
  targetId = '';
  private id = 0;
  private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', ev => {
      const m = JSON.parse(String(ev.data));
      const w = m.id ? this.waiting.get(m.id) : undefined;
      if (w) { this.waiting.delete(m.id); m.error ? w.fail(new Error(`${m.error.message}`)) : w.ok(m.result); }
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((ok, fail) => { ws.addEventListener('open', () => ok()); ws.addEventListener('error', () => fail(new Error('CDP connect failed'))); });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, fail) => { this.waiting.set(id, { ok, fail }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }
  async waitFor(expression: string, what: string, ms = 8000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await this.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`timed out waiting for: ${what}`);
  }
  close() { this.ws.close(); }
}

// ---------------------------------------------------------------------------------------------- fixtures
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 6);
const uid = String(randomInt(500000000001, 599999999999));
const rids: string[] = [];
const cardLast4: string[] = [];
let taxiId = '';
let baseUrl = '';
let chrome: ChildProcess | undefined;
let profileDir = '';
let debugPort = 0;
let menuRestaurant = '';
let activeOrderId = '';
let historyOrderId = '';
const initData = () => signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: Number(uid), first_name: 'UI', username: 'ui' }),
}, BOT_TOKEN);
const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined, headers: { authorization: `tma ${initData()}` }, remoteAddress: `10.9.${randomInt(0, 255)}.${randomInt(1, 255)}` });

before(async () => {
  if (skipReason) return;
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.equal(name, 'ds_delivery_test', `refusing to run against database "${name}"`);
  const mk = async (slug: string, title: string, products: number) => {
    const r = await db.restaurant.create({ data: { slug: `${slug}-${nonce}`, name: title, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } });
    rids.push(r.id);
    for (let i = 0; i < products; i++) await db.product.create({ data: { restaurantId: r.id, name: `Taom ${i + 1} ${title}`, description: 'Mazali va issiq, yangi tayyorlangan', priceSom: 12_000 + i * 500 } });
    return r.id;
  };
  menuRestaurant = await mk('ui-a', `Uzun Menyu ${nonce}`, 30);
  await mk('ui-b', `Lavash Markazi ${nonce}`, 3);
  await mk('ui-c', `Shashlik Uyi ${nonce}`, 3);
  for (;;) { const c = String(randomInt(1000, 9999)); if (await db.card.findUnique({ where: { last4: c } })) continue; cardLast4.push(c); await engine.addCard(c, true, menuRestaurant); break; }
  taxiId = (await db.taxiCompany.create({ data: { name: `UI Taxi ${randomUUID()}`, isActive: true, operatorTelegramUserId: operatorTg } })).id;
  await db.restaurant.update({ where: { id: menuRestaurant }, data: { pickupAddress: 'Pickup 1' } });
  // an ACTIVE order (cooking) created first, then a CANCELLED one created later: the list must still put the active one on top
  const p = await db.product.findFirstOrThrow({ where: { restaurantId: menuRestaurant } });
  const place = async () => (await api('POST', '/orders', { checkoutKey: randomUUID(), restaurantId: menuRestaurant, items: [{ productId: p.id, quantity: 1 }],
    expectedTotalSom: p.priceSom, address: { addressText: 'UI street 1' }, phone: '+998901234567' })).json().order.id as string;
  activeOrderId = await place();
  assert.equal((await api('POST', `/orders/${activeOrderId}/mock-payment`)).statusCode, 200);
  await new Promise(r => setTimeout(r, 30));
  historyOrderId = await place();
  assert.equal((await api('POST', `/orders/${historyOrderId}/cancel`, {})).statusCode, 200);

  await app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'ds-ui-chrome-'));
  debugPort = randomInt(20000, 40000);
  chrome = spawn(browserPath!, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, '--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
  const end = Date.now() + 15000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break; } catch { /* starting */ }
    if (Date.now() > end) throw new Error('Chrome did not start');
    await new Promise(r => setTimeout(r, 200));
  }
});
after(async () => {
  chrome?.kill();
  if (skipReason) { await db.$disconnect(); await appDb.$disconnect(); return; }
  const customers = await db.customer.findMany({ where: { telegramUserId: uid }, select: { id: true } });
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = (await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays } }, { cardLast4: { in: cardLast4 } }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays } } });
  const cards = (await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(c => c.id);
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: { in: customers.map(c => c.id) } } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
  await new Promise(r => setTimeout(r, 500));
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
});

async function openPage(width: number): Promise<Cdp> {
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string };
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  page.targetId = target.id;
  await page.send('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,session_storage' }); // each width starts with an empty cart
  await page.send('Page.enable');
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*telegram.org*'] }); // the real SDK would replace the stub
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 2, mobile: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { const back = { visible: false, cbs: [] };
      window.__back = back;
      window.Telegram = { WebApp: { initData: ${JSON.stringify(initData())}, ready() {}, expand() {}, close() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {},
        onEvent() {}, offEvent() {}, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        BackButton: { show() { back.visible = true; }, hide() { back.visible = false; }, onClick(cb) { back.cbs.push(cb); }, offClick(cb) { back.cbs = back.cbs.filter(x => x !== cb); } } } }; })();` });
  return page;
}
async function go(page: Cdp, hash: string) {
  await page.send('Page.navigate', { url: `${baseUrl}/app/${hash}` });
  await page.waitFor(`document.querySelector('.app') || document.querySelector('[role=alert]')`, 'app shell');
}
const noOverflow = (page: Cdp) => page.eval<{ sw: number; iw: number; wide: string[] }>(`(() => { const iw = window.innerWidth;
  const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > iw + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' && !e.closest('[aria-hidden=true]'); }).slice(0, 5).map(e => e.tagName + '.' + e.className);
  return { sw: document.documentElement.scrollWidth, iw, wide }; })()`);
async function assertNoOverflow(page: Cdp, label: string) {
  const o = await noOverflow(page);
  assert.ok(o.sw <= o.iw, `${label}: horizontal scroll (scrollWidth ${o.sw} > ${o.iw}) offenders: ${o.wide.join(', ')}`);
}
const tabbarTop = `document.querySelector('.tabbar').getBoundingClientRect().top`;

for (const width of [320, 375, 390, 430]) {
  test(`Mini App UI @${width}px`, { skip: skipReason }, async t => {
    const page = await openPage(width);
    try {
      await t.test('home loads, lists restaurants, no horizontal overflow', async () => {
        await go(page, '#/');
        await page.waitFor(`document.querySelectorAll('.card.tap').length >= 3`, 'restaurant cards');
        assert.ok(await page.eval(`document.body.innerText.includes('Lavash Markazi ${nonce}')`));
        await assertNoOverflow(page, 'home');
      });
      await t.test('search filters, and focusing it keeps the tab bar and navigation', async () => {
        await page.eval(`document.querySelector('input[type=search]').focus()`);
        await page.send('Input.insertText', { text: 'Lavash' });
        await page.waitFor(`document.querySelectorAll('.card.tap').length === 1`, 'one search result');
        assert.ok(await page.eval(`document.body.innerText.includes('Lavash Markazi ${nonce}') && !document.body.innerText.includes('Shashlik Uyi ${nonce}')`));
        const bar = await page.eval<{ shown: boolean; bottomOk: boolean; buttons: number }>(`(() => { const b = document.querySelector('.tabbar'); const r = b.getBoundingClientRect();
          return { shown: getComputedStyle(b).display !== 'none' && r.height > 30, bottomOk: r.bottom <= window.innerHeight + 1 && r.top >= 0, buttons: b.querySelectorAll('button').length }; })()`);
        assert.deepEqual(bar, { shown: true, bottomOk: true, buttons: 4 }, 'tab bar remains while the search field is focused');
        await page.send('Input.insertText', { text: ' zzzz-no-match' });
        await page.waitFor(`document.querySelectorAll('.card.tap').length === 0`, 'empty result');
        await assertNoOverflow(page, 'search');
      });
      await t.test('tab bar hides only while the keyboard really shrinks the screen, and always comes back', async () => {
        const barShown = () => page.eval<boolean>(`(() => { const b = document.querySelector('.tabbar'); return getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 30; })()`);
        const setHeight = (height: number) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
        await go(page, '#/');
        await page.eval(`document.querySelector('input[type=search]').focus()`);
        assert.equal(await barShown(), true, 'focused, no keyboard yet: bar stays');
        await setHeight(380); // the keyboard takes the lower part
        await page.waitFor(`document.documentElement.dataset.kb === 'open'`, 'keyboard detected');
        assert.equal(await barShown(), false, 'keyboard open: no bar above the keyboard');
        await setHeight(700); // the keyboard is closed with the back key; the field keeps focus
        await page.waitFor(`!document.documentElement.dataset.kb`, 'keyboard closed');
        assert.equal(await barShown(), true, 'keyboard closed but field still focused: bar is back');
        await setHeight(380);
        await page.waitFor(`document.documentElement.dataset.kb === 'open'`, 'keyboard detected again');
        await page.eval(`document.activeElement.blur()`);
        await page.waitFor(`!document.documentElement.dataset.kb`, 'field blurred');
        assert.equal(await barShown(), true, 'field lost focus: bar is back even on a short screen');
        await setHeight(700);
      });
      await t.test('menu: the last item is not covered by the tab bar; add to cart', async () => {
        await go(page, `#/menu/${menuRestaurant}`);
        await page.waitFor(`document.querySelectorAll('button').length > 10`, 'menu products');
        await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
        await new Promise(r => setTimeout(r, 300));
        const gap = await page.eval<number>(`(() => { const items = [...document.querySelectorAll('.app-main button, .app-main .card')]; let bottom = 0;
          for (const e of items) bottom = Math.max(bottom, e.getBoundingClientRect().bottom); return ${tabbarTop} - bottom; })()`);
        assert.ok(gap >= -1, `content ends ${-gap}px under the tab bar`);
        await assertNoOverflow(page, 'menu');
        await page.eval(`window.scrollTo(0, 0)`);
        await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Qo‘shish')).click()`);
        await page.waitFor(`document.body.innerText.includes('Savat •')`, 'cart bar after add');
      });
      await t.test('cart persists across a reload', async () => {
        const before = await page.eval<string>(`localStorage.getItem('ds.cart.v1')`);
        assert.ok(before && JSON.parse(before).lines.length === 1);
        await page.send('Page.reload');
        await page.waitFor(`document.querySelector('.app')`, 'app after reload');
        await go(page, `#/menu/${menuRestaurant}`);
        await page.waitFor(`document.body.innerText.includes('Savat •')`, 'cart restored after reload');
        assert.equal(await page.eval(`localStorage.getItem('ds.cart.v1')`), before);
      });
      await t.test('Back: Telegram BackButton is shown on a menu and returns home; hidden on tab pages', async () => {
        await go(page, `#/menu/${menuRestaurant}`);
        await page.waitFor(`window.__back.visible && window.__back.cbs.length > 0`, 'back button shown');
        await page.eval(`window.__back.cbs.at(-1)()`);
        await page.waitFor(`location.hash === '#/' || location.hash === ''`, 'navigated home');
        await page.waitFor(`!window.__back.visible`, 'back button hidden on home');
      });
      await t.test('checkout: every field is reachable above the tab bar; no overflow', async () => {
        await go(page, '#/checkout');
        await page.waitFor(`document.querySelector('textarea#adr') || document.querySelector('input[name=addr]')`, 'checkout form');
        // The price quote (payment choices, taxi services) arrives asynchronously and changes the page height: measure only after it is in.
        await page.waitFor(`[...document.querySelectorAll('.app-main button')].some(b => /(To‘lovga o‘tish|Buyurtma berish) • /.test(b.textContent))`, 'checkout total');
        await new Promise(r => setTimeout(r, 500));
        await page.eval(`(document.querySelector('input[value=""][name=addr], input[name=addr]:last-of-type') || {}).click?.()`);
        // inputs: centred in the viewport must be fully visible and clear of the tab bar; the submit button: after scrolling to the very bottom
        const hidden = await page.eval<string[]>(`(async () => { const bad = []; const top = () => ${tabbarTop};
          for (const el of document.querySelectorAll('.app-main input:not([type=radio]):not([type=checkbox]), .app-main textarea')) {
            el.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 30));
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.bottom > top() + 1 || r.top < 0)) bad.push(el.tagName + ':' + (el.placeholder || '').slice(0, 24));
            if (r.right > window.innerWidth + 1 || r.left < -1) bad.push('wide:' + el.tagName);
          }
          window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 200));
          const submit = [...document.querySelectorAll('.app-main button')].find(b => b.textContent.includes('To‘lovga o‘tish') || b.textContent.includes('Buyurtma berish'));
          if (!submit) bad.push('no submit button'); else if (submit.getBoundingClientRect().bottom > top() + 1) bad.push('submit covered by tab bar');
          return bad; })()`);
        assert.deepEqual(hidden, [], 'fields stay clear of the tab bar when scrolled into view');
        await assertNoOverflow(page, 'checkout');
      });
      await t.test('orders: active order is above history; status labels are correct', async () => {
        await go(page, '#/orders');
        await page.waitFor(`document.body.innerText.includes('Buyurtmalar tarixi')`, 'history section');
        const r = await page.eval<{ activeY: number; historyY: number; text: string }>(`(() => { const find = t => [...document.querySelectorAll('.status-line, .card')].find(e => e.textContent.includes(t));
          const a = find('Tayyorlanmoqda'); const h = [...document.querySelectorAll('.card')].find(e => e.textContent.includes('Bekor qilingan'));
          return { activeY: a ? a.getBoundingClientRect().top : -1, historyY: h ? h.getBoundingClientRect().top : -1, text: document.body.innerText }; })()`);
        assert.ok(r.activeY > 0 && r.historyY > 0, `both cards present (active ${r.activeY}, history ${r.historyY})`);
        assert.ok(r.activeY < r.historyY, 'active order is listed above the history');
        assert.ok(r.text.indexOf('Faol buyurtmalar') < r.text.indexOf('Buyurtmalar tarixi'));
        assert.ok(!/To‘lov kutilmoqda/.test(r.text), 'the cancelled order is not shown as awaiting payment');
        await assertNoOverflow(page, 'orders');
        // detail pages use the same labels
        await go(page, `#/order/${activeOrderId}`);
        await page.waitFor(`document.body.innerText.includes('Tayyorlanmoqda')`, 'active detail label');
        await go(page, `#/order/${historyOrderId}`);
        await page.waitFor(`document.body.innerText.includes('Bekor qilingan')`, 'cancelled detail label');
        await assertNoOverflow(page, 'order detail');
      });
      await t.test('error state is visible with a retry button when the API fails', async () => {
        await page.send('Network.setBlockedURLs', { urls: ['*telegram.org*', '*/api/v1/miniapp/restaurants*'] });
        await go(page, '#/');
        await page.waitFor(`document.querySelector('[role=alert]')`, 'error box');
        const box = await page.eval<{ text: string; visible: boolean }>(`(() => { const e = document.querySelector('[role=alert]'); const r = e.getBoundingClientRect(); return { text: e.innerText, visible: r.height > 20 && r.top >= 0 && r.right <= window.innerWidth + 1 }; })()`);
        assert.ok(box.visible, 'error box inside the viewport');
        assert.ok(box.text.trim().length > 5 && box.text.includes('Qayta urinish'), box.text);
        await page.send('Network.setBlockedURLs', { urls: ['*telegram.org*'] });
        await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Qayta urinish')).click()`);
        await page.waitFor(`document.querySelectorAll('.card.tap').length >= 3`, 'recovers after retry');
      });
      await t.test('outside Telegram (no initData) the app asks to open it from Telegram', async () => {
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__stripped = true;` });
        const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string };
        const bare = await Cdp.connect(target.webSocketDebuggerUrl);
        try {
          await bare.send('Page.enable'); await bare.send('Network.enable');
          await bare.send('Network.setBlockedURLs', { urls: ['*telegram.org*'] });
          await bare.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 2, mobile: true });
          await bare.send('Page.navigate', { url: `${baseUrl}/app/#/` });
          await bare.waitFor(`document.body.innerText.includes('Telegram orqali oching')`, 'open-in-Telegram notice');
          await assertNoOverflow(bare, 'no-telegram');
        } finally { bare.close(); }
      });
    } finally { page.close(); await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.targetId}`).catch(() => undefined); }
  });
}

test('control: the tab-bar overlap check can actually fail (guards against a vacuous pass)', { skip: skipReason }, async () => {
  const page = await openPage(375);
  try {
    await go(page, `#/menu/${menuRestaurant}`);
    await page.waitFor(`document.querySelectorAll('button').length > 10`, 'menu products');
    await page.eval(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.app-main{padding-bottom:0!important}' }))`);
    await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await new Promise(r => setTimeout(r, 300));
    const gap = await page.eval<number>(`(() => { let bottom = 0; for (const e of document.querySelectorAll('.app-main button, .app-main .card')) bottom = Math.max(bottom, e.getBoundingClientRect().bottom); return ${tabbarTop} - bottom; })()`);
    assert.ok(gap < -1, `with the reserved space removed the content must be detected under the tab bar (gap ${gap})`);
  } finally { page.close(); await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.targetId}`).catch(() => undefined); }
});
