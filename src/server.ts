import './lib/preflight.js';
import { db } from './lib/db.js';
import { env } from './lib/env.js';
import { buildApp } from './app.js';
import { runtime } from './lib/health.js';
import { createShutdown } from './lib/shutdown.js';
import { PaymentEngineV3, defaultOptions } from './modules/payment/engine.js';
import { startGmail } from './modules/payment/gmail.js';
import { gmailAlertSender } from './bot/gmail-alerts.js';
import { startCardApprovalNotifier } from './bot/card-admin.js';
import { createClientBot } from './bot/client.js';
import { createTaxiBot } from './bot/taxi-bot.js';
import { chatCheckoutEnabled, miniAppUrl, setMiniAppMenuButton } from './bot/miniapp-launch.js';
import { restaurantTelegramEnabled } from './lib/features.js';
import { startBotPaymentNotifier } from './bot/notify.js';
import { startRestaurantOrderNotifier } from './bot/restaurant-notify.js';
import { startSupportNotifier } from './bot/support-notify.js';
import { startTaxiDispatcher } from './modules/taxi/worker.js';

const opts = {
  paymentWindowMs: Number(process.env.PAYMENT_WINDOW_SECONDS ?? 300) * 1000,
  queueWindowMs: Number(process.env.QUEUE_WINDOW_SECONDS ?? 600) * 1000,
  cooldownMs: Number(process.env.CARD_COOLDOWN_SECONDS ?? 120) * 1000,
  ambiguityMs: Number(process.env.AMBIGUITY_WINDOW_SECONDS ?? 900) * 1000,
};
if (Object.values(opts).some(v => !Number.isSafeInteger(v) || v <= 0)) throw new Error('Invalid payment interval');
const engine = new PaymentEngineV3(db, { ...defaultOptions, ...opts });
const app = buildApp(engine);
let stopGmail: (() => void) | undefined;
let clientBot: ReturnType<typeof createClientBot> | undefined;
let taxiBot: ReturnType<typeof createTaxiBot> | undefined;
let stopBotNotifier: (() => void) | undefined;
let stopCardNotifier: (() => void) | undefined;
let stopRestaurantNotifier: (() => void) | undefined;
let stopTaxiDispatcher: (() => void) | undefined;
let stopSupportNotifier: (() => void) | undefined;
let botStarted = false;
let taxiBotStarted = false;
let busy = false;
let maintenanceRun: Promise<void> | undefined;
const maintenance = setInterval(() => {
  if (busy) return;
  busy = true;
  maintenanceRun = (async () => {
    try { await engine.maintenance(); }
    catch (err) { app.log.error({ err }, 'Payment maintenance failed'); }
    finally { busy = false; }
  })();
}, Number(process.env.MAINTENANCE_SECONDS ?? 5) * 1000);

/** Telegraf throws if stop() is called while polling is not running (e.g. it already died). */
function stopPolling(reason: string) {
  if (botStarted) { try { clientBot?.stop(reason); } catch { /* already stopped */ } }
  if (taxiBotStarted) { try { taxiBot?.stop(reason); } catch { /* already stopped */ } }
}

/** In Telegraf 4.x launch() only settles when polling STOPS, so awaiting it would never reach the workers. It calls
 *  onLaunch right after getMe() succeeded; a later rejection means polling died (409 = another process or a webhook
 *  uses this token, 401 = token revoked) and is fatal for the whole process. */
function launchPolling(bot: { launch: (cfg: object, onLaunch: () => void) => Promise<void> }, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let up = false;
    bot.launch({}, () => { up = true; resolve(); }).catch((err: unknown) => {
      if (!up) { reject(err); return; }
      const conflict = typeof err === 'object' && err !== null && (err as { code?: number }).code === 409;
      app.log.error({ err, bot: name }, conflict
        ? `Telegram polling conflict (409): another process or a webhook is using the ${name} token. Stop the other instance.`
        : `Telegram ${name} polling stopped unexpectedly`);
      exitAfter('POLLING_FAILED', 1);
    });
  });
}

/** Order: stop taking new work (health goes 503, timers and workers stop, polling stops), let an in-flight payment maintenance pass
 *  finish, drain HTTP, then close the database. Bounded by SHUTDOWN_TIMEOUT_SECONDS (default 15) so it can never hang. */
const shutdown = createShutdown(() => [
  { name: 'health', run: () => { runtime.phase = 'stopping'; } },
  { name: 'timers', run: () => clearInterval(maintenance) },
  { name: 'gmail', run: () => stopGmail?.() },
  { name: 'bot-notifier', run: () => stopBotNotifier?.() },
  { name: 'restaurant-notifier', run: () => stopRestaurantNotifier?.() },
  { name: 'taxi-dispatcher', run: () => stopTaxiDispatcher?.() },
  { name: 'support-notifier', run: () => stopSupportNotifier?.() },
  { name: 'card-notifier', run: () => stopCardNotifier?.() },
  { name: 'telegram-polling', run: () => stopPolling('shutdown') },
  { name: 'maintenance-in-flight', run: async () => { await maintenanceRun; } },
  { name: 'http', run: () => app.close() },
  { name: 'database', run: () => db.$disconnect() },
], {
  timeoutMs: Math.max(1, Number(process.env.SHUTDOWN_TIMEOUT_SECONDS ?? 15)) * 1000,
  log: (msg, extra) => (extra ? app.log.warn(extra, msg) : app.log.info(msg)),
});
const exitAfter = (reason: string, code: number) => { void shutdown(reason).then(r => process.exit(r.timedOut ? 1 : code)); };
process.once('SIGINT', () => exitAfter('SIGINT', 0));
process.once('SIGTERM', () => exitAfter('SIGTERM', 0));

try {
  await db.$connect();
  await app.listen({ host: env.HOST, port: env.PORT });
  if (env.BOT_ENABLED === 'true') {
    const token = env.BOT_TOKEN?.trim();
    if (!token || !/^\d+:[a-zA-Z0-9_-]{20,}$/.test(token)) {
      throw new Error('BOT_ENABLED=true, ammo BOT_TOKEN yozilmagan yoki formati noto‘g‘ri');
    }
    const dbName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
    if (process.env.BOT_PAYMENT_MODE === 'REAL' && /test/i.test(dbName)) {
      throw new Error(`BOT_PAYMENT_MODE=REAL test bazasida (${dbName}) ruxsat etilmaydi`);
    }
    app.log.info({ database: dbName, paymentMode: process.env.BOT_PAYMENT_MODE === 'REAL' ? 'REAL' : 'MOCK',
      checkout: process.env.RESTAURANT_MANUAL_ACCEPTANCE === 'true' ? 'LEGACY manual acceptance' : 'automatic (validated, payment is the last step)',
      restaurantTelegramPanel: restaurantTelegramEnabled() ? 'ENABLED (legacy rollback)' : 'disabled (restaurants use the app)',
      taxiOperatorAllowlist: Boolean(process.env.TAXI_OPERATOR_ALLOWLIST?.trim()) }, 'Telegram bot configuration');
    clientBot = createClientBot(token, engine);
    await launchPolling(clientBot, 'customer bot');
    // The Android app builds its Telegram deep link from the bot's own username unless BOT_USERNAME is set explicitly.
    if (!process.env.BOT_USERNAME?.trim() && clientBot.botInfo?.username) process.env.BOT_USERNAME = clientBot.botInfo.username;
    botStarted = true;
    runtime.customerBot = 'polling';
    app.log.info('Telegram client bot started in polling mode');
    {
      const menu = await setMiniAppMenuButton(clientBot);
      app.log.info({ miniApp: menu, miniAppUrl: miniAppUrl() ? 'configured' : 'not configured', chatCheckout: chatCheckoutEnabled() }, 'Mini App launcher');
    }
    stopBotNotifier = startBotPaymentNotifier(clientBot);
    stopRestaurantNotifier = startRestaurantOrderNotifier(clientBot);
    const taxiToken = process.env.TAXI_BOT_TOKEN?.trim();
    if (taxiToken) {
      if (!/^\d+:[a-zA-Z0-9_-]{20,}$/.test(taxiToken)) throw new Error('TAXI_BOT_TOKEN formati noto‘g‘ri');
      if (taxiToken === token) throw new Error('TAXI_BOT_TOKEN mijoz boti tokenidan farq qilishi kerak (bir token ikki marta polling qila olmaydi)');
      taxiBot = createTaxiBot(taxiToken);
      await launchPolling(taxiBot, 'taxi bot');
      taxiBotStarted = true;
      runtime.taxiBot = 'polling';
      app.log.info('Telegram taxi operator bot started in polling mode');
    } else {
      app.log.warn('TAXI_BOT_TOKEN is not set: taxi operators are served by the customer bot (legacy mode)');
    }
    // Customers and restaurant staff are notified by the customer bot; operators are messaged by the taxi bot.
    stopTaxiDispatcher = startTaxiDispatcher(clientBot, taxiBot ?? clientBot);
    app.log.info('Taxi dispatch worker started (DB-backed)');
    stopSupportNotifier = startSupportNotifier(clientBot);
    app.log.info('Support ticket notifier started');
    stopCardNotifier = startCardApprovalNotifier(clientBot);
    app.log.info('Card approval notifier started');
  }
  // Gmail starts only after Telegram polling is confirmed: a duplicate instance gets 409 and exits before it ever reads the mailbox.
  if (env.GMAIL_ENABLED === 'true') {
    try { stopGmail = await startGmail(engine, { onAlert: gmailAlertSender(clientBot) }); }
    catch (err) { app.log.error({ err }, 'Gmail failed to start. API remains available.'); }
  }
  runtime.phase = 'ready';
} catch (err) {
  app.log.error(err);
  await shutdown('startup failed');
  process.exitCode = 1;
}
