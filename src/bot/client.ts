import { Telegraf, Markup, session } from 'telegraf';
import { randomUUID } from 'node:crypto';
import { CheckoutError, placeOrder, orderDetails } from '../modules/orders/service.js';
import { paymentMode, payeeNumber } from '../modules/payment/requisites.js';
import { chatCheckoutEnabled, launcherKeyboard, LAUNCH_TEXT, miniAppUrl, registerMiniAppLauncher } from './miniapp-launch.js';
import type { PaymentEngineV3 } from '../modules/payment/engine.js';
import { normalizeUzPhone, checkoutSummary } from './checkout.js';
import type { Context } from 'telegraf';
import { db } from '../lib/db.js';
import type { Cart } from './cart.js';
import { cartTotal, changeQuantity, countItems, removeItem } from './cart.js';
import { registerRestaurantDisabledHandlers, registerRestaurantHandlers } from './restaurant.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { advanceMockOrder } from '../modules/restaurant-orders/auto.js';
import { registerTaxiHandlers } from './taxi.js';
import { registerSupportHandlers } from './support.js';
import { registerCardAdminHandlers } from './card-admin.js';
import { registerMoneyAdminHandlers } from './money-admin.js';
import { registerOrderCancelHandler } from './order-cancel.js';
import { registerRefundHandlers } from './refunds.js';
import { handleLinkStart, isLinkPayload, registerTelegramLinkHandlers } from './telegram-link.js';

type CheckoutStep = 'phone' | 'address-choice' | 'address-text' | 'location' | 'location-note' | 'taxi' | 'confirm' | 'placed';
interface CheckoutState {
  key: string;
  flow: string;
  step: CheckoutStep;
  phone?: string;
  addressText?: string;
  lat?: number;
  lng?: number;
  taxiCompanyId?: string;
  taxiCompanyName?: string;
  allowTaxiFallback?: boolean;
  orderId?: string;
  /** The total the customer was shown on the confirmation screen; checkout refuses if prices changed since. */
  expectedTotalSom?: number;
}
interface ClientSession {
  restaurantId?: string;
  cart: Cart;
  checkout?: CheckoutState;
}
type ClientContext = Context & { session: ClientSession };
type Keyboard = ReturnType<typeof Markup.inlineKeyboard>;
type ProductSnapshot = {
  id: string;
  name: string;
  priceSom: number;
  isAvailable: boolean;
  restaurantId: string;
};

const PAGE_SIZE = 6;
const numberFormatter = new Intl.NumberFormat('uz-UZ');
function som(amount: number) { return `${numberFormatter.format(amount)} so‘m`; }
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function freshSession(): ClientSession { return { cart: {} }; }

// Existing inline messages may survive after the server restarts.
function currentSession(ctx: ClientContext): ClientSession {
  ctx.session ??= freshSession();
  return ctx.session;
}

async function screen(ctx: ClientContext, text: string, keyboard: Keyboard): Promise<void> {
  const extra = { parse_mode: 'HTML' as const, reply_markup: keyboard.reply_markup };
  if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (err) {
      // Telegram returns 400 if the message was not changed; not an application error.
      if (err instanceof Error && /message is not modified/i.test(err.message)) return;
    }
  }
  await ctx.reply(text, extra);
}

async function restaurants(ctx: ClientContext): Promise<void> {
  const list = await db.restaurant.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, isPaused: true },
    take: 30,
  });
  if (!list.length) {
    await ctx.reply('Hozircha faol restoranlar mavjud emas. Keyinroq qayta urinib ko‘ring.');
    return;
  }
  const keys = list.map(r => [Markup.button.callback(
    `${r.isPaused ? '⏸ ' : '🍽 '}${r.name.slice(0, 48)}`, `r:${r.id}`,
  )]);
  keys.push([Markup.button.callback('🛒 Savat', 'cart')]);
  await screen(ctx, '<b>🍽 DS Delivery</b>\nRestoranni tanlang:', Markup.inlineKeyboard(keys));
}

async function chooseRestaurant(ctx: ClientContext, restaurantId: string): Promise<void> {
  const r = await db.restaurant.findFirst({ where: { id: restaurantId, isActive: true }, select: { id: true } });
  if (!r) { await ctx.reply('Restoran topilmadi. /start orqali qayta tanlang.'); return; }
  const state = currentSession(ctx);
  const oldRestaurant = state.restaurantId;
  if (oldRestaurant && oldRestaurant !== restaurantId) {
    state.cart = {};
    state.checkout = undefined;
  }
  state.restaurantId = r.id;
  await menu(ctx, restaurantId, 'all', 0);
}

async function menu(ctx: ClientContext, restaurantId: string, categoryId: string, page: number): Promise<void> {
  const state = currentSession(ctx);
  if (state.restaurantId !== restaurantId) {
    await ctx.reply('Menyu eskirgan. /start orqali restoranni qayta tanlang.'); return;
  }
  const r = await db.restaurant.findFirst({
    where: { id: restaurantId, isActive: true },
    select: { id: true, name: true, isPaused: true,
      categories: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
  if (!r) { await restaurants(ctx); return; }
  if (categoryId !== 'all' && !r.categories.some(c => c.id === categoryId)) categoryId = 'all';
  const filter = {
    restaurantId: r.id,
    isAvailable: true,
    ...(categoryId !== 'all' ? { categoryId } : {}),
  };
  const total = await db.product.count({ where: filter });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const validPage = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
  const products = await db.product.findMany({
    where: filter,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: validPage * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { id: true, name: true, priceSom: true },
  });
  const selected = categoryId === 'all' ? 'Barchasi' : r.categories.find(c => c.id === categoryId)?.name ?? 'Barchasi';
  const status = r.isPaused ? '\n⏸ <i>Restoran hozir buyurtma qabul qilmayapti.</i>' : '';
  const text = `<b>🍽 ${escapeHtml(r.name)}</b>${status}\n` +
    `Bo‘lim: <b>${escapeHtml(selected)}</b>\n` +
    `Mahsulotlar: ${total} ta | ${validPage + 1}/${pages} sahifa\n\n` +
    (products.length ? 'Batafsil ko‘rish uchun mahsulotni tanlang.' : 'Bu bo‘limda mahsulot yo‘q.');
  const keys = [] as ReturnType<typeof Markup.button.callback>[][];
  if (r.categories.length) {
    keys.push([Markup.button.callback('📋 Barchasi', `m:${r.id}:all:0`)]);
    for (const c of r.categories.slice(0, 12)) {
      keys.push([Markup.button.callback(`📂 ${c.name.slice(0, 45)}`, `m:${r.id}:${c.id}:0`)]);
    }
  }
  for (const p of products) {
    keys.push([Markup.button.callback(`${p.name.slice(0, 34)} • ${som(p.priceSom)}`, `p:${p.id}:${categoryId}:${validPage}`)]);
  }
  const paging = [] as ReturnType<typeof Markup.button.callback>[];
  if (validPage > 0) paging.push(Markup.button.callback('⬅️ Oldingi', `m:${r.id}:${categoryId}:${validPage - 1}`));
  if (validPage + 1 < pages) paging.push(Markup.button.callback('Keyingi ➡️', `m:${r.id}:${categoryId}:${validPage + 1}`));
  if (paging.length) keys.push(paging);
  keys.push([Markup.button.callback(`🛒 Savat (${countItems(state.cart)})`, 'cart')]);
  keys.push([Markup.button.callback('🏪 Restoranlar', 'restaurants')]);
  await screen(ctx, text, Markup.inlineKeyboard(keys));
}

async function productDetails(ctx: ClientContext, productId: string, categoryId: string, page: number): Promise<void> {
  const state = currentSession(ctx);
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, description: true, priceSom: true, isAvailable: true, restaurantId: true },
  });
  if (!p || !p.isAvailable || p.restaurantId !== state.restaurantId) {
    await ctx.reply('Mahsulot hozir mavjud emas. /start orqali menyuni yangilang.'); return;
  }
  const text = `<b>${escapeHtml(p.name)}</b>\n` +
    `${p.description ? `${escapeHtml(p.description.slice(0, 600))}\n` : ''}` +
    `\n💵 Narxi: <b>${som(p.priceSom)}</b>\n` +
    `🛒 Savatda: ${state.cart[p.id] ?? 0} ta`;
  await screen(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback('➕ Savatga qo‘shish', `a:${p.id}:${categoryId}:${page}`)],
    [Markup.button.callback('⬅️ Menyuga', `m:${p.restaurantId}:${categoryId}:${page}`), Markup.button.callback('🛒 Savat', 'cart')],
  ]));
}

async function addProduct(ctx: ClientContext, productId: string, categoryId: string, page: number): Promise<void> {
  const state = currentSession(ctx);
  const p: ProductSnapshot | null = await db.product.findUnique({ where: { id: productId }, select: {
    id: true, name: true, priceSom: true, isAvailable: true, restaurantId: true,
  } });
  if (!p || !p.isAvailable || p.restaurantId !== state.restaurantId) {
    await ctx.reply('Mahsulot mavjud emas yoki boshqa restoranga tegishli.'); return;
  }
  try { state.cart = changeQuantity(state.cart, p.id, 1); state.checkout = undefined; }
  catch (err) {
    const code = err instanceof Error ? err.message : '';
    await ctx.reply(code === 'MAX_QUANTITY' ? 'Bitta mahsulotdan ko‘pi bilan 30 ta qo‘shish mumkin.' : 'Savatda ko‘pi bilan 20 xil mahsulot bo‘lishi mumkin.');
    return;
  }
  await productDetails(ctx, productId, categoryId, page);
}

async function showCart(ctx: ClientContext): Promise<void> {
  const state = currentSession(ctx);
  if (!state.restaurantId) {
    await restaurants(ctx); return;
  }
  const ids = Object.keys(state.cart);
  if (!ids.length) {
    await screen(ctx, '<b>🛒 Savatingiz bo‘sh.</b>\nMahsulot qo‘shish uchun menyuga qayting.',
      Markup.inlineKeyboard([[Markup.button.callback('🍽 Menyu', `m:${state.restaurantId}:all:0`)]]));
    return;
  }
  const items = await db.product.findMany({
    where: { id: { in: ids }, restaurantId: state.restaurantId },
    select: { id: true, name: true, priceSom: true, isAvailable: true },
  });
  const available = new Map(items.map(item => [item.id, item]));
  const prices = new Map(items.map(item => [item.id, item.priceSom]));
  let total = 0;
  const lines: string[] = [];
  const keys = [] as ReturnType<typeof Markup.button.callback>[][];
  let i = 0;
  for (const id of ids) {
    const p = available.get(id);
    if (!p) {
      lines.push('⚠️ Endi mavjud bo‘lmagan mahsulot (o‘chirish mumkin)');
      keys.push([Markup.button.callback('🗑 O‘chirish', `q:${id}:del`)]);
      continue;
    }
    const quantity = state.cart[id]!;
    const lineTotal = p.priceSom * quantity;
    if (p.isAvailable) total += lineTotal;
    lines.push(`${++i}. <b>${escapeHtml(p.name)}</b>${!p.isAvailable ? ' ⚠️ mavjud emas' : ''}\n   ${quantity} × ${som(p.priceSom)} = ${som(lineTotal)}`);
    keys.push([
      Markup.button.callback('➖', `q:${p.id}:minus`),
      Markup.button.callback(`${quantity} ta`, `q:${p.id}:noop`),
      Markup.button.callback('➕', `q:${p.id}:plus`),
      Markup.button.callback('🗑', `q:${p.id}:del`),
    ]);
  }
  const calculated = cartTotal(state.cart, prices);
  const caveat = total !== calculated ? '\n⚠️ Mavjud bo‘lmagan mahsulotlar umumiy summaga kiritilmadi.' : '';
  const text = `<b>🛒 Savat</b>\n\n${lines.join('\n\n')}\n\n` +
    `<b>Jami: ${som(total)}</b>${caveat}\n\n` +
    '<i>Yetkazish haqi taksi tarifi bo‘yicha alohida to‘lanadi.</i>';
  keys.push([Markup.button.callback('✅ Buyurtma berish', 'checkout:start')]);
  keys.push([Markup.button.callback('🍽 Menyuga qaytish', `m:${state.restaurantId}:all:0`)]);
  keys.push([Markup.button.callback('🏪 Boshqa restoran', 'restaurants')]);
  await screen(ctx, text, Markup.inlineKeyboard(keys));
}

async function updateCart(ctx: ClientContext, productId: string, op: string): Promise<void> {
  const state = currentSession(ctx);
  if (!(productId in state.cart)) { await showCart(ctx); return; }
  const p = await db.product.findUnique({ where: { id: productId }, select: {
    restaurantId: true, isAvailable: true,
  } });
  if (op === 'del') state.cart = removeItem(state.cart, productId);
  else if (op === 'noop') { await showCart(ctx); return; }
  else if (p?.restaurantId !== state.restaurantId || (op === 'plus' && !p?.isAvailable)) {
    await ctx.reply('Mahsulot mavjud emas.'); return;
  } else {
    try { state.cart = changeQuantity(state.cart, productId, op === 'plus' ? 1 : -1); }
    catch { await ctx.reply('Bitta mahsulotdan ko‘pi bilan 30 ta qo‘shish mumkin.'); return; }
  }
  state.checkout = undefined;
  await showCart(ctx);
}


const mode = paymentMode;
function keyboardClear() { return Markup.removeKeyboard(); }
function ensureCheckout(ctx: ClientContext, step: CheckoutStep): CheckoutState | null {
  const check = currentSession(ctx).checkout;
  if (!check || check.step !== step) return null;
  return check;
}
function botUserId(ctx: ClientContext) {
  if (!ctx.from?.id) throw new Error('Telegram foydalanuvchi identifikatori yo‘q');
  return String(ctx.from.id);
}

async function beginCheckout(ctx: ClientContext): Promise<void> {
  const state = currentSession(ctx);
  if (!state.restaurantId || !Object.keys(state.cart).length) {
    await ctx.reply('Savat bo‘sh. /start orqali mahsulot tanlang.'); return;
  }
  const rest = await db.restaurant.findUnique({ where: { id: state.restaurantId } });
  if (!rest?.isActive || rest.isPaused) {
    await ctx.reply('Restoran hozir buyurtma olmayapti.'); return;
  }
  const products = await db.product.findMany({
    where: { id: { in: Object.keys(state.cart) }, restaurantId: rest.id, isAvailable: true },
  });
  if (products.length !== Object.keys(state.cart).length) {
    await ctx.reply('Savatdagi mahsulotlardan biri hozir mavjud emas. Savatni yangilang.'); return;
  }
  if (mode() === 'REAL') {
    if (process.env.GMAIL_ENABLED !== 'true') {
      await ctx.reply('Real to‘lov yoqilmagan: Gmail monitoringi o‘chiq.'); return;
    }
    const realCards = await db.card.findMany({ where: { restaurantId: rest.id, isTest: false, active: true } });
    if (!realCards.length || realCards.some(c => !payeeNumber(c))) {
      await ctx.reply('Restoran uchun haqiqiy karta rekvizitlari sozlanmagan. Administratorga murojaat qiling.'); return;
    }
  } else {
    const mockCards = await db.card.count({ where: { restaurantId: rest.id, isTest: true, active: true } });
    if (!mockCards) { await ctx.reply('Sinov kartasi yo‘q. npm run seed ni tekshiring.'); return; }
  }
  state.checkout = { key: randomUUID(), flow: randomUUID().slice(0, 8), step: 'phone' };
  await ctx.reply('📞 Telefon raqamingizni yuboring yoki +998901234567 ko‘rinishida yozing.',
    Markup.keyboard([[Markup.button.contactRequest('📱 Raqamimni yuborish')]]).resize().oneTime());
}

async function gotPhone(ctx: ClientContext, value: string): Promise<void> {
  const check = ensureCheckout(ctx, 'phone');
  if (!check) return;
  const phone = normalizeUzPhone(value);
  if (!phone) {
    await ctx.reply('Noto‘g‘ri telefon raqam. Masalan: +998901234567'); return;
  }
  check.phone = phone;
  check.step = 'address-choice';
  await ctx.reply('Telefon saqlandi. Endi yetkazish manzilini tanlang.', keyboardClear());
  await ctx.reply('📍 Manzilni qanday yuborasiz?', Markup.inlineKeyboard([
    [Markup.button.callback('📍 Telegram lokatsiyasi', `checkout:location:${check.flow}`)],
    [Markup.button.callback('✍️ Matnli manzil', `checkout:address-text:${check.flow}`)],
  ]));
}

async function chooseAddressText(ctx: ClientContext): Promise<void> {
  const check = ensureCheckout(ctx, 'address-choice');
  if (!check) { await ctx.reply('Avval savatdan buyurtmani boshlang.'); return; }
  check.step = 'address-text';
  await ctx.reply('Yetkazish manzilini yozing. Ko‘cha, uy raqami yoki mo‘ljal (kamida 3 belgi).');
}
async function chooseLocation(ctx: ClientContext): Promise<void> {
  const check = ensureCheckout(ctx, 'address-choice');
  if (!check) { await ctx.reply('Avval savatdan buyurtmani boshlang.'); return; }
  check.step = 'location';
  await ctx.reply('📍 Pastdagi tugma orqali lokatsiyangizni yuboring.',
    Markup.keyboard([[Markup.button.locationRequest('📍 Lokatsiyani yuborish')]]).resize().oneTime());
}

async function taxiOptions(ctx: ClientContext): Promise<void> {
  const check = currentSession(ctx).checkout;
  if (!check || !check.addressText || !check.phone) return;
  check.step = 'taxi';
  const taxis = await db.taxiCompany.findMany({ where: { isActive: true, ...(mode() === 'REAL' ? { operatorTelegramUserId: { not: null } } : {}) }, orderBy: { name: 'asc' }, take: 20 });
  if (!taxis.length) {
    await ctx.reply('Hozircha taksi xizmati qo‘shilmagan. Administrator taksi xizmatini kiritishi kerak.'); return;
  }
  await ctx.reply('🚕 Taksi kompaniyasini tanlang. Yakuniy yetkazish narxini taksi xizmati belgilaydi.',
    Markup.inlineKeyboard(taxis.map(t => [Markup.button.callback(t.name.slice(0, 55), `checkout:taxi:${t.id}:${check.flow}`)])));
}

async function confirmScreen(ctx: ClientContext): Promise<void> {
  const state = currentSession(ctx);
  const check = ensureCheckout(ctx, 'confirm');
  if (!check?.phone || !check.addressText || !check.taxiCompanyName || !state.restaurantId) return;
  const rest = await db.restaurant.findUnique({ where: { id: state.restaurantId }, select: { name: true } });
  const products = await db.product.findMany({
    where: { id: { in: Object.keys(state.cart) }, restaurantId: state.restaurantId, isAvailable: true },
    select: { id: true, priceSom: true },
  });
  if (!rest || products.length !== Object.keys(state.cart).length) {
    await ctx.reply('Mahsulot ma’lumotlari o‘zgargan. /cart orqali qayta tekshiring.'); return;
  }
  const amountSom = products.reduce((sum, p) => sum + p.priceSom * (state.cart[p.id] ?? 0), 0);
  check.expectedTotalSom = amountSom;
  await ctx.reply(checkoutSummary({ restaurant: rest.name, phone: check.phone,
    address: check.addressText, taxi: check.taxiCompanyName, amountSom, mock: mode() === 'MOCK' }) +
    `\nBoshqa taksi izlashga rozilik: <b>${check.allowTaxiFallback ? 'Ha' : 'Yo‘q'}</b>`, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback(check.allowTaxiFallback ? '🔁 Boshqa taksiga ruxsat: HA ✅' : '🔁 Boshqa taksiga ruxsat: YO‘Q', `checkout:fallback:${check.flow}`)],
      [Markup.button.callback('✅ Tasdiqlash', `checkout:confirm:${check.flow}`)],
      [Markup.button.callback('❌ Ortga (savat saqlanadi)', `checkout:cancel:${check.flow}`)],
    ]).reply_markup,
  });
}

async function showOrder(ctx: ClientContext, orderId: string): Promise<void> {
  const order = await orderDetails(orderId);
  if (!order || order.customerTelegramUserId !== botUserId(ctx)) {
    await ctx.reply('Buyurtma topilmadi.'); return;
  }
  const pay = order.payment;
  const lines = [
    `🧾 <b>Buyurtma #${order.number}</b>`,
    `Restoran: ${escapeHtml(order.restaurantName)}`,
    `Tanlangan taksi: ${escapeHtml(order.taxiCompanyName ?? 'Tanlanmagan')}`,
    `Taomlar: <b>${som(order.totalSom)}</b>`,
    'Yetkazish: taksi tarifi bo‘yicha, alohida to‘lanadi',
    `Buyurtma holati: <b>${escapeHtml(order.status)}</b>`,
    ...(order.status === 'READY' ? ['🍽 Taom tayyor, ammo hali yetkazilgan emas.'] : []),
  ];
  const refund = await db.refundRequest.findFirst({ where: { orderId: order.id }, orderBy: { requestedAt: 'desc' }, select: { number: true, status: true } });
  const refundLine = refund ? `Qaytarish #${refund.number}: ${refund.status}.` : '';
  const taxiAttempts = await db.taxiDispatch.findMany({
    where: { orderId: order.id }, orderBy: { attemptNo: 'desc' }, take: 1,
    include: { taxiCompany: { select: { name: true } } },
  });
  const taxiState = taxiAttempts[0];
  if (taxiState) {
    const taxiStateLabels: Record<string, string> = {
      SCHEDULED: '📆 Taksi chaqirish rejalashtirilgan',
      SENDING: '⏳ Operatorga xabar yuborilmoqda',
      REQUESTED: '⏳ Taksi operatori javobi kutilmoqda',
      CANCELLATION_PENDING: '⚠️ Operator javobi kechikdi, tekshiruv davom etmoqda',
      ASSIGNED: '🚕 Operator haydovchi yuborilganini tasdiqladi',
      DECLINED: '🚫 Taksi topilmadi', CANCELLED: '🚫 Taksi so‘rovi bekor qilindi', NEEDS_HELP: '⚠️ Taksi uchun administrator yordami kerak',
    };
    lines.push(`${taxiStateLabels[taxiState.status] ?? taxiState.status} — ${escapeHtml(taxiState.taxiCompany.name)}`);
  }
  if (order.status === 'WAITING_RESTAURANT') lines.push('⏳ Restoran buyurtmani tasdiqlashi kutilmoqda. To‘lov rekvizitlari tasdiqdan keyin yuboriladi. Hozir pul yubormang.');
  else if (order.status === 'CANCELLATION_REQUESTED') lines.push('⏳ Bekor qilish so‘rovi restoranga yuborilgan. Qaror kutilmoqda; buyurtma to‘xtatilgan.');
  else if (order.status === 'CANCELLED') lines.push('❌ Buyurtma bekor qilingan.' + (refundLine ? ` ${refundLine}` : ''));
  else if (order.status === 'CUSTOMER_CANCELLED') lines.push('❌ Buyurtma bekor qilingan. Pul yubormang.');
  else if (order.status === 'RESTAURANT_REJECTED') lines.push('🚫 Restoran buyurtmani qabul qila olmadi. Pul yubormang.');
  else if (order.status === 'RESTAURANT_EXPIRED') lines.push('⌛ Restoran vaqtida javob bermadi. Pul yubormang; yangi buyurtma berishingiz mumkin.');
  else if (!pay) lines.push('To‘lov yaratilmagan.');
  else if (pay.status === 'QUEUED') {
    lines.push('⌛ Hozir mos karta band. Navbatdasiz. Karta ajratilmaguncha pul yubormang.');
  } else if (pay.status === 'AWAITING') {
    if (mode() === 'MOCK' || pay.card?.isTest) {
      lines.push(`🧪 <b>SINOV!</b> MOCK karta ***${pay.card?.last4 ?? '????'}. Haqiqiy pul yubormang.`);
    } else {
      const requisites = pay.card ? payeeNumber(pay.card) : null;
      if (!requisites) lines.push('⚠️ Karta rekvizitlari mavjud emas. Pul yubormang, administratorga murojaat qiling.');
      else lines.push(`💳 Restoran kartasi: <code>${requisites}</code>`);
      lines.push('⚠️ Bu xabar kirimni mustaqil bank tasdig‘i bilan tekshirmaydi.');
    }
    if (pay.expiresAt) lines.push(`⏱ To‘lov oynasi tugashi: ${new Intl.DateTimeFormat('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(pay.expiresAt))} (Toshkent)`);
    lines.push('Faqat ko‘rsatilgan summani yuboring. To‘lov oynasi tugasa, qayta pul yubormang.');
  } else if (pay.status === 'MATCHED_UNVERIFIED') {
    lines.push('🔎 Kirim xabari mos keldi, lekin bank bo‘yicha yakuniy tasdiq hali yo‘q.');
  } else if (pay.status === 'CONFIRMED_MANUAL') {
    lines.push('✅ Restoran bankdagi kirimni alohida tekshirib tasdiqladi.');
  } else if (pay.status === 'EXPIRED' || pay.status === 'QUEUE_EXPIRED') {
    lines.push('⌛ To‘lov oynasi tugadi. Pul yuborgan bo‘lsangiz, administrator bilan bog‘laning.');
  } else lines.push(`To‘lov holati: ${escapeHtml(pay.status)}`);
  const keys = [[Markup.button.callback('🔄 Holatni yangilash', `checkout:status:${order.id}`)]];
  if (['PAYMENT_PENDING', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(order.status)) {
    keys.push([Markup.button.callback('❌ Bekor qilish', `order:cx:${order.id}`)]);
  }
  if (pay?.status === 'AWAITING' && pay.card?.isTest && mode() === 'MOCK' && process.env.NODE_ENV !== 'production') {
    keys.push([Markup.button.callback('🧪 MOCK kirim (pul yubormasdan)', `checkout:mock:${order.id}`)]);
  }
  if (order.status === 'WAITING_RESTAURANT' || order.status === 'WAITING_CUSTOMER_CONSENT') {
    keys.push([Markup.button.callback('❌ Buyurtmani bekor qilish', `order:cancel:${order.id}`)]);
  }
  keys.push([Markup.button.callback('🏪 Restoranlar', 'restaurants')]);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(keys).reply_markup });
  if (pay) {
    await db.payment.updateMany({
      where: { id: pay.id, status: pay.status }, data: { botLastNotifiedStatus: pay.status },
    });
  }
}

async function listMyOrders(ctx: ClientContext): Promise<void> {
  const orders = await db.order.findMany({
    where: { createdViaBot: true, customer: { telegramUserId: botUserId(ctx) } },
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { id: true, number: true, status: true, totalSom: true },
  });
  if (!orders.length) { await ctx.reply('Hozircha buyurtmangiz yo‘q.'); return; }
  await ctx.reply('🧾 Buyurtmalaringiz:', Markup.inlineKeyboard(orders.map(o => [
    Markup.button.callback(`#${o.number} • ${som(o.totalSom)} • ${o.status}`, `checkout:status:${o.id}`),
  ])));
}

/** `telegramOptions` exists so tests can point the bot at a local fake Telegram API; production passes nothing. */
export function createClientBot(token: string, engine: PaymentEngineV3, telegramOptions?: Partial<Telegraf.Options<ClientContext>>['telegram']): Telegraf<ClientContext> {
  const bot = new Telegraf<ClientContext>(token, telegramOptions ? { telegram: telegramOptions } : undefined);
  // Customer interactions only in private chats. No group data exposure.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    return next();
  });
  bot.use(session({ defaultSession: freshSession }));
  registerMiniAppLauncher(bot); // /app, and the chat-checkout rollback switch (CHAT_CHECKOUT_ENABLED)
  registerTelegramLinkHandlers(bot); // optional Android guest -> Telegram link (explicit confirmation on both sides)
  bot.start(async ctx => {
    if (isLinkPayload(ctx.startPayload)) { await handleLinkStart(ctx, ctx.startPayload); return; }
    const url = miniAppUrl();
    if (url) await ctx.reply(LAUNCH_TEXT, launcherKeyboard(url)); // the Mini App is the way to order; the bot notifies and supports
    if (!url || chatCheckoutEnabled()) await restaurants(ctx);   // legacy chat checkout stays until the Mini App E2E has passed
  });
  bot.action('orders:list', async ctx => { await ctx.answerCbQuery(); await listMyOrders(ctx); });
  bot.command('restaurants', async ctx => { await restaurants(ctx); });
  bot.command('menu', async ctx => {
    const id = currentSession(ctx).restaurantId;
    if (id) await menu(ctx, id, 'all', 0); else await restaurants(ctx);
  });
  bot.command('cart', async ctx => { await showCart(ctx); });
  bot.command('orders', async ctx => { await listMyOrders(ctx); });
  bot.command('reset', async ctx => {
    ctx.session = freshSession();
    await ctx.reply('Savat tozalandi. /start bilan qayta boshlang.');
  });
  bot.action('restaurants', async ctx => { await ctx.answerCbQuery(); await restaurants(ctx); });
  bot.action('cart', async ctx => { await ctx.answerCbQuery(); await showCart(ctx); });
  bot.action(/^r:([\w-]+)$/, async ctx => {
    await ctx.answerCbQuery(); await chooseRestaurant(ctx, ctx.match[1]!);
  });
  bot.action(/^m:([\w-]+):([\w-]+):(\d+)$/, async ctx => {
    await ctx.answerCbQuery(); await menu(ctx, ctx.match[1]!, ctx.match[2]!, Number(ctx.match[3]));
  });
  bot.action(/^p:([\w-]+):([\w-]+):(\d+)$/, async ctx => {
    await ctx.answerCbQuery(); await productDetails(ctx, ctx.match[1]!, ctx.match[2]!, Number(ctx.match[3]));
  });
  bot.action(/^a:([\w-]+):([\w-]+):(\d+)$/, async ctx => {
    await ctx.answerCbQuery(); await addProduct(ctx, ctx.match[1]!, ctx.match[2]!, Number(ctx.match[3]));
  });
  bot.action(/^q:([\w-]+):(plus|minus|del|noop)$/, async ctx => {
    await ctx.answerCbQuery(); await updateCart(ctx, ctx.match[1]!, ctx.match[2]!);
  });
  bot.action('checkout:start', async ctx => { await ctx.answerCbQuery(); await beginCheckout(ctx); });
  bot.action(/^checkout:address-text:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    if (currentSession(ctx).checkout?.flow === ctx.match[1]) await chooseAddressText(ctx);
  });
  bot.action(/^checkout:location:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    if (currentSession(ctx).checkout?.flow === ctx.match[1]) await chooseLocation(ctx);
  });
  bot.action(/^checkout:locationdone:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    if (ensureCheckout(ctx, 'location-note')?.flow === ctx.match[1]) await taxiOptions(ctx);
  });
  bot.action(/^checkout:taxi:([\w-]+):([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    const check = ensureCheckout(ctx, 'taxi');
    if (!check || check.flow !== ctx.match[2]) return;
    const taxi = await db.taxiCompany.findFirst({ where: { id: ctx.match[1]!, isActive: true } });
    if (!taxi) { await ctx.reply('Taksi xizmati topilmadi.'); return; }
    check.taxiCompanyId = taxi.id;
    check.taxiCompanyName = taxi.name;
    check.step = 'confirm';
    await confirmScreen(ctx);
  });
  bot.action(/^checkout:fallback:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    const check = ensureCheckout(ctx, 'confirm');
    if (!check || check.flow !== ctx.match[1]) return;
    check.allowTaxiFallback = !check.allowTaxiFallback;
    await confirmScreen(ctx);
  });
  bot.action(/^checkout:cancel:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    if (currentSession(ctx).checkout?.flow !== ctx.match[1]) return;
    currentSession(ctx).checkout = undefined;
    await ctx.reply('Buyurtma tasdiqlanmadi. Savatingiz saqlandi.');
    await showCart(ctx);
  });
  const inFlight = new Set<string>();
  bot.action(/^checkout:confirm:([0-9a-f]{8})$/, async ctx => {
    await ctx.answerCbQuery();
    const id = botUserId(ctx);
    const state = currentSession(ctx);
    const check = state.checkout;
    if (!check || check.flow !== ctx.match[1] || (check.step !== 'confirm' && check.step !== 'placed')) {
      await ctx.reply('Bu tugma eskirgan. Savatdan qayta boshlang.'); return;
    }
    if (check.step === 'placed' && check.orderId) { await showOrder(ctx, check.orderId); return; }
    if (inFlight.has(id)) { await ctx.reply('Buyurtmangiz yaratilyapti, biroz kuting.'); return; }
    if (!check.phone || !check.addressText || !check.taxiCompanyId || !state.restaurantId) return;
    inFlight.add(id);
    try {
      const result = await placeOrder(engine, {
        restaurantId: state.restaurantId, telegramUserId: id,
        customerName: ctx.from?.first_name,
        phone: check.phone, addressText: check.addressText,
        deliveryLat: check.lat, deliveryLng: check.lng,
        taxiCompanyId: check.taxiCompanyId, checkoutKey: check.key,
        createdViaBot: true, paymentMode: mode(),
        allowTaxiFallback: Boolean(check.allowTaxiFallback),
        ...(check.expectedTotalSom !== undefined ? { expectedTotalSom: check.expectedTotalSom } : {}),
        items: Object.entries(state.cart).map(([productId, quantity]) => ({ productId, quantity })),
      });
      if (!result) throw new Error('Buyurtma ma’lumotlari topilmadi');
      check.step = 'placed';
      check.orderId = result.id;
      state.cart = {};
      await showOrder(ctx, result.id);
    } catch (error) {
      console.error('[BOT CHECKOUT]', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof CheckoutError && error.message === 'NARX_OZGARGAN') {
        // Stage 6F: prices are validated before payment. Nothing was created; show the customer the new total to confirm again.
        await ctx.reply('⚠️ Narxlar o‘zgargan, buyurtma yaratilmadi va pul olinmadi. Yangi jami summani ko‘rib, qayta tasdiqlang.');
        await confirmScreen(ctx);
      } else if (error instanceof CheckoutError && error.message === 'MAHSULOT_MAVJUD_EMAS') {
        await ctx.reply('⚠️ Savatdagi mahsulotlardan biri hozir mavjud emas. Buyurtma yaratilmadi. /cart orqali savatni yangilang.');
      } else if (error instanceof CheckoutError && error.message === 'RESTORAN_BUYURTMA_QABUL_QILMAYDI') {
        await ctx.reply('⛔ Restoran hozir buyurtma olmayapti. Buyurtma yaratilmadi.');
      } else {
        await ctx.reply('Buyurtmani yakunlab bo‘lmadi. Restoran, mahsulot yoki karta holatini tekshiring. Pul yubormang.');
      }
    } finally { inFlight.delete(id); }
  });
  bot.action(/^checkout:status:([\w-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    await showOrder(ctx, ctx.match[1]!);
  });
  bot.action(/^checkout:mock:([\w-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (mode() !== 'MOCK' || process.env.NODE_ENV === 'production') return;
    const order = await orderDetails(ctx.match[1]!);
    if (!order || order.customerTelegramUserId !== botUserId(ctx) ||
        order.payment?.status !== 'AWAITING' || !order.payment.card?.isTest) {
      await ctx.reply('MOCK to‘lov faol emas.'); return;
    }
    await engine.ingestMock(BigInt(order.totalSom) * 100n, order.payment.card.last4);
    await advanceMockOrder(order.id).catch(err => console.error('[MOCK AUTO]', err instanceof Error ? err.message : err)); // test payment -> cooking, no staff step
    await showOrder(ctx, order.id);
  });
  // Register /staff and /myid before the generic text handler, which consumes messages.
  if (restaurantTelegramEnabled()) registerRestaurantHandlers(bot, engine); // legacy staff panel, rollback only
  else registerRestaurantDisabledHandlers(bot);
  if (process.env.TAXI_BOT_TOKEN?.trim()) {
    // Stage 6D: taxi operators work in the dedicated taxi bot; this bot never shows or answers dispatch requests.
    bot.command('taxi', async ctx => { await ctx.reply('Taksi operatorlari uchun alohida DS Taxi bot ishlatiladi.'); });
  } else {
    registerTaxiHandlers(bot);
  }
  registerSupportHandlers(bot);
  registerCardAdminHandlers(bot); // /cards + approval of restaurant-added payee cards (support admins only)
  registerMoneyAdminHandlers(bot); // /money: unmatched incoming money and long-unconfirmed payments (support admins only)
  registerOrderCancelHandler(bot);
  registerRefundHandlers(bot, engine);
  bot.help(async ctx => { await ctx.reply('/start — restoranlar\n/menu — menyu\n/cart — savat\n/orders — mening buyurtmalarim\n/reset — savatni tozalash\n/staff — restoran xodimi uchun\n/taxi — taksi operatori\n/support — buyurtma bo‘yicha murojaat\n/mytickets — murojaatlarim\n/myid — Telegram ID'); });
  bot.on('contact', async ctx => {
    const contact = ctx.message.contact;
    if (!ensureCheckout(ctx, 'phone')) return;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      await ctx.reply('Iltimos, o‘zingizning telefon raqamingizni yuboring.'); return;
    }
    await gotPhone(ctx, contact.phone_number);
  });
  bot.on('location', async ctx => {
    const check = ensureCheckout(ctx, 'location');
    if (!check) return;
    check.lat = ctx.message.location.latitude;
    check.lng = ctx.message.location.longitude;
    check.addressText = 'Telegram lokatsiyasi';
    check.step = 'location-note';
    await ctx.reply('Lokatsiya olindi. Qo‘shimcha mo‘ljal yozing yoki davom eting.', keyboardClear());
    await ctx.reply('Mo‘ljal ixtiyoriy:', Markup.inlineKeyboard([
      [Markup.button.callback('✅ Davom etish', `checkout:locationdone:${check.flow}`)],
    ]));
  });
  bot.on('text', async ctx => {
    const check = currentSession(ctx).checkout;
    if (!check) return;
    const value = ctx.message.text.trim();
    if (value.startsWith('/')) return;
    if (check.step === 'phone') { await gotPhone(ctx, value); return; }
    if (check.step === 'address-text') {
      if (value.length < 3 || value.length > 500) {
        await ctx.reply('Manzil 3–500 belgi bo‘lishi kerak. Qayta yozing.'); return;
      }
      check.addressText = value;
      await taxiOptions(ctx);
      return;
    }
    if (check.step === 'location-note') {
      if (value.length > 300) { await ctx.reply('Mo‘ljal juda uzun (300 belgigacha).'); return; }
      check.addressText = `Telegram lokatsiyasi. Mo‘ljal: ${value}`;
      await taxiOptions(ctx);
      return;
    }
  });
  bot.catch((err, ctx) => {
    // No token, message body, or sensitive user details in logs.
    console.error('[BOT ERROR]', err instanceof Error ? err.message : 'Unknown error');
    void ctx.reply('Vaqtinchalik xatolik. Birozdan keyin /start orqali qayta urinib ko‘ring.').catch(() => undefined);
  });
  return bot;
}
