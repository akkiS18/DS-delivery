import { db } from './lib/db.js';
import { env } from './lib/env.js';
import { buildApp } from './app.js';
import { PaymentEngineV3, defaultOptions } from './modules/payment/engine.js';
import { startGmail } from './modules/payment/gmail.js';
import { createClientBot } from './bot/client.js';
import { startBotPaymentNotifier } from './bot/notify.js';
import { startRestaurantOrderNotifier } from './bot/restaurant-notify.js';
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
let stopBotNotifier: (() => void) | undefined;
let stopRestaurantNotifier: (() => void) | undefined;
let stopTaxiDispatcher: (() => void) | undefined;
let botStarted = false;
let busy = false;
const maintenance = setInterval(async () => {
  if (busy) return;
  busy = true;
  try { await engine.maintenance(); }
  catch (err) { app.log.error({ err }, 'Payment maintenance failed'); }
  finally { busy = false; }
}, Number(process.env.MAINTENANCE_SECONDS ?? 5) * 1000);

async function shutdown(signal: string) {
  app.log.info(`${signal}: closing`);
  clearInterval(maintenance);
  stopGmail?.();
  stopBotNotifier?.();
  stopRestaurantNotifier?.();
  stopTaxiDispatcher?.();
  if (botStarted) clientBot?.stop(signal);
  await app.close();
  await db.$disconnect();
}
process.once('SIGINT', () => { void shutdown('SIGINT').then(() => process.exit(0)); });
process.once('SIGTERM', () => { void shutdown('SIGTERM').then(() => process.exit(0)); });

try {
  await db.$connect();
  await app.listen({ host: env.HOST, port: env.PORT });
  if (env.GMAIL_ENABLED === 'true') {
    try { stopGmail = await startGmail(engine); }
    catch (err) { app.log.error({ err }, 'Gmail failed to start. API remains available.'); }
  }
  if (env.BOT_ENABLED === 'true') {
    const token = env.BOT_TOKEN?.trim();
    if (!token || !/^\d+:[a-zA-Z0-9_-]{20,}$/.test(token)) {
      throw new Error('BOT_ENABLED=true, ammo BOT_TOKEN yozilmagan yoki formati noto‘g‘ri');
    }
    clientBot = createClientBot(token, engine);
    await clientBot.launch();
    botStarted = true;
    app.log.info('Telegram client bot started in polling mode');
    stopBotNotifier = startBotPaymentNotifier(clientBot);
    stopRestaurantNotifier = startRestaurantOrderNotifier(clientBot);
    stopTaxiDispatcher = startTaxiDispatcher(clientBot);
    app.log.info('Taxi dispatch worker started (DB-backed)');
  }
} catch (err) {
  clearInterval(maintenance);
  stopGmail?.();
  stopBotNotifier?.();
  stopRestaurantNotifier?.();
  stopTaxiDispatcher?.();
  if (botStarted) clientBot?.stop('startup failed');
  app.log.error(err);
  await app.close().catch(() => undefined);
  await db.$disconnect();
  process.exitCode = 1;
}
