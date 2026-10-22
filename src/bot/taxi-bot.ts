import { Telegraf, type Context } from 'telegraf';
import { registerTaxiHandlers, registerTaxiLinkHandlers } from './taxi.js';
import { registerTaxiAdminHandlers } from './taxi-admin.js';

/** The dedicated Telegram identity for taxi operators (TAXI_BOT_TOKEN). It shares the backend, database and dispatch
 *  state machine with the customer bot but exposes nothing else: no menus, carts, orders or restaurant tools.
 *  `telegramOptions` exists so tests can point it at a local fake Telegram API. */
export function createTaxiBot(token: string, telegramOptions?: Partial<Telegraf.Options<Context>>['telegram']): Telegraf<Context> {
  const bot = new Telegraf<Context>(token, telegramOptions ? { telegram: telegramOptions } : undefined);
  // Operators only ever talk to the bot in a private chat: no group exposure of addresses or phone numbers.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    return next();
  });
  registerTaxiHandlers(bot);      // /taxi + taxi:* buttons (company-scoped authorization)
  registerTaxiAdminHandlers(bot); // /taxiadmin recovery for platform administrators (support admin ids only)
  registerTaxiLinkHandlers(bot);  // /start, /link, /myid, bare codes - registered last: it owns plain text
  bot.catch((err, ctx) => {
    console.error('[TAXI BOT]', ctx.updateType, err instanceof Error ? err.message : err);
    void ctx.reply('Vaqtinchalik xatolik. Birozdan keyin qayta urinib ko‘ring.').catch(() => undefined);
  });
  return bot;
}
