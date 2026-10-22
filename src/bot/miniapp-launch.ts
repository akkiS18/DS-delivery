import { Markup, type Context, type Telegraf } from 'telegraf';
import { miniAppEnabled } from '../modules/miniapp/routes.js';

/**
 * The customer bot's role next to the Mini App: launcher, status notifier (the existing notifiers) and support entry.
 * MINIAPP_URL must be the public HTTPS address of the deployed Mini App (Telegram refuses plain http and localhost on phones).
 */
export function miniAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!miniAppEnabled(env)) return null;
  const url = env.MINIAPP_URL?.trim();
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

/** Rollback switch for the old chat checkout (cart / address / phone dialogue in the bot). Default ON until the Mini App passed its E2E. */
export const chatCheckoutEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.CHAT_CHECKOUT_ENABLED?.trim().toLowerCase() !== 'false';

export const LAUNCH_TEXT = '🍽 Buyurtma berish uchun DS Delivery ilovasini oching. Restoran, menyu, manzil va to‘lov — hammasi shu yerda.';

export function launcherKeyboard(url: string) {
  return Markup.inlineKeyboard([
    [Markup.button.webApp('🍽 Buyurtma berish', url)],
    [Markup.button.callback('📦 Buyurtmalarim', 'orders:list')],
  ]);
}

/** Old chat-checkout entry points answer with the launcher when CHAT_CHECKOUT_ENABLED=false. Existing orders stay reachable. */
const CHECKOUT_ACTIONS = /^(?:r:|m:|p:|a:|q:|cart$|restaurants$|checkout:(?!status|mock))/;
const CHECKOUT_COMMANDS = new Set(['restaurants', 'menu', 'cart']);

export function registerMiniAppLauncher<C extends Context>(bot: Telegraf<C>): void {
  bot.command('app', async ctx => {
    const url = miniAppUrl();
    await ctx.reply(url ? LAUNCH_TEXT : 'Ilova hozircha sozlanmagan.', url ? launcherKeyboard(url) : undefined);
  });
  bot.use(async (ctx, next) => {
    if (chatCheckoutEnabled()) return next();
    const url = miniAppUrl();
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const command = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0] : '';
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    if ((command && CHECKOUT_COMMANDS.has(command)) || (data && CHECKOUT_ACTIONS.test(data))) {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => undefined);
      await ctx.reply(url ? LAUNCH_TEXT : 'Buyurtma berish hozircha mavjud emas.', url ? launcherKeyboard(url) : undefined);
      return;
    }
    return next();
  });
}

/** Menu button next to the message field opens the Mini App. Best effort: a failure here never stops the bot. */
export async function setMiniAppMenuButton(bot: Telegraf<any>): Promise<'SET' | 'SKIPPED' | 'FAILED'> {
  const url = miniAppUrl();
  if (!url) return 'SKIPPED';
  try {
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Buyurtma berish', web_app: { url } } });
    return 'SET';
  } catch (err) {
    console.error('[MINIAPP MENU]', err instanceof Error ? err.message : err);
    return 'FAILED';
  }
}
