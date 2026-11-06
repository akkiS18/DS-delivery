import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin, supportAdminIds } from '../modules/support/service.js';
import { paymentsPanel, setRealPaymentsOpen } from '../modules/platform/settings.js';
import { cashEnabled, loadCashMaxOrderSom, setCashEnabled } from '../modules/payment/method.js';
import { loadTaxiMode, setTaxiMode, type TaxiDispatchMode } from '../modules/taxi/mode.js';
import { loadFeeConfig, setFeeMode } from '../modules/pricing/config.js';
import { type FeeConfig, type FeeMode } from '../modules/pricing/fee.js';
import { db } from '../lib/db.js';
import { planRestaurantRemoval, planTaxiRemoval, removeRestaurant, removeTaxiCompany, type RemovalOutcome, type RemovalPlan } from '../modules/platform/removal.js';
import { createTaxiCompanyByAdmin, resetTaxiAccessByAdmin } from '../modules/taxi-app/provision.js';
import { createRestaurantByAdmin, linkStaffByAdmin, resetRestaurantPasswordByAdmin } from '../modules/restaurant/provision.js';
import { IMAGE_MAX_BYTES, setRestaurantImage } from '../modules/restaurant/image.js';
import { listPromotionsForAdmin, setPromotionActive, setPromotionCap, setPromotionProducts } from '../modules/promotions/service.js';
import { createDemoOrder, removeDemoOrders, DEMO_MAX_AGE_MS } from '../modules/restaurant-orders/demo.js';
import { createTaxiDemoRequest, removeTaxiDemoRequest, DEMO_TAXI_MAX_AGE_MS } from '../modules/taxi-app/demo.js';
import { platformRatingsOverview, REASON_LABEL, setRankingEnabled, type RatingReason } from '../modules/ratings/service.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Stage 9: platform-administrator commands. /payments opens and closes real payments; /newrestaurant, /resetpassword, /linkstaff set restaurants up. */
export async function renderPayments(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> | null }> {
  const p = await paymentsPanel();
  const lines = ['💳 <b>Real to‘lov</b>'];
  if (!p.gateActive) {
    lines.push('Bu test serveri: kalit faqat production serverda ishlaydi.');
    return { text: lines.join('\n'), keyboard: null };
  }
  lines.push(p.open ? '🟢 <b>OCHIQ</b>: mijozlar haqiqiy pul to‘lashi mumkin.' : '🔴 <b>YOPIQ</b>: yangi buyurtma olinmaydi.');
  if (!p.open && p.blockers.length) {
    lines.push('', 'Yoqib bo‘lmaydi:', ...p.blockers.map(b => `• ${escapeHtml(b)}`));
    return { text: lines.join('\n'), keyboard: null };
  }
  const button = p.open ? Markup.button.callback('⛔ Yopish', 'pay:ask:0') : Markup.button.callback('▶️ Real to‘lovni yoqish', 'pay:ask:1');
  if (p.open) lines.push('Yopsangiz ham, allaqachon berilgan buyurtmalar to‘lovi davom etadi.');
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard([[button]]) };
}

const FEE_LABEL: Record<FeeMode, string> = {
  FLAT: 'Eski rejim (xizmat haqi ko‘rsatilmaydi)', PERCENT: 'Foiz', TIERED: 'Pog‘onali (50 000 gacha 10%, keyin 3%)', LINE: 'Alohida qator «Platforma xizmati»',
};
const somText = (n: number): string => n.toLocaleString('en-US').replace(/,/g, ' ');
/** Owner request 2026-11-06: "Tekis" = the platform line is shown crossed out as a discount and nobody pays it; "5 000 so‘m" = the same line, charged to the customer. */
export async function renderFee(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const c: FeeConfig = await loadFeeConfig();
  const free = c.mode === 'LINE' && c.lineWaived;
  const paid = c.mode === 'LINE' && !c.lineWaived;
  const now = free ? `<b>Tekis — chegirma</b>: mijoz «Platforma xizmati ${somText(c.lineSom)}» qatorini ustidan chizilgan holda ko‘radi, hech kim to‘lamaydi (na mijoz, na restoran).`
    : paid ? `<b>${somText(c.lineSom)} so‘m</b>: taomlardan keyin alohida qator «Platforma xizmati ${somText(c.lineSom)}», mijoz to‘laydi.`
    : `<b>${FEE_LABEL[c.mode]}</b>${c.mode === 'PERCENT' ? ` — ${c.percentBp / 100}%` : ''}`;
  const text = [
    '🧾 <b>Xizmat haqi</b>',
    `Hozir: ${now}`,
    ...(c.mode === 'FLAT' ? ['', '⚠️ Bu eski rejim: mijoz hech narsa ko‘rmaydi, har yetkazilgan buyurtma uchun restoran hisobiga 5 000 yoziladi. «Tekis — chegirma»ni tanlang.'] : []),
    '',
    '<b>Tekis — chegirma</b>: taomlardan keyin «Platforma xizmati 5 000» ustidan chizilib, «Chegirma» deb ko‘rsatiladi. Hech kimdan haq olinmaydi.',
    `<b>${somText(c.lineSom)} so‘m</b>: shu qator chizilmaydi, mijoz to‘laydi (Yandexdagi servis haqiga o‘xshash). Summa: <code>/fee som 5000</code> (1 000–50 000).`,
    '<b>Foiz / pog‘onali</b>: xizmat haqi taom narxlariga kiritilgan, mijoz yaxlit narx ko‘radi; platforma ulushi restoran bilan hisob-kitobda yuritiladi.',
    'Rejim faqat YANGI buyurtmalarga ta’sir qiladi.',
    '',
    'Foiz: <code>/fee 8</code> (1–25).',
  ].join('\n');
  const mark = (on: boolean) => (on ? '● ' : '');
  return { text, keyboard: Markup.inlineKeyboard([
    [Markup.button.callback(`${mark(free)}Tekis (chegirma)`, 'fee:set:FREE'), Markup.button.callback(`${mark(paid)}${somText(c.lineSom)} so‘m`, 'fee:set:LINE')],
    [Markup.button.callback(`${mark(c.mode === 'PERCENT')}Foiz`, 'fee:set:PERCENT'), Markup.button.callback(`${mark(c.mode === 'TIERED')}Pog‘onali`, 'fee:set:TIERED')],
  ]) };
}

export async function renderCash(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const on = await cashEnabled();
  const text = [
    '💵 <b>Naqd to‘lov</b>',
    on ? '🟢 <b>YOQILGAN</b>: mijoz naqd to‘lashni tanlay oladi.' : '🔴 <b>O‘CHIRILGAN</b>: yangi naqd buyurtma olinmaydi.',
    '',
    `Naqd buyurtmani restoran qabul qiladi, taksi operatori summani ko‘radi va pulli haydovchi yuboradi. Eng ko‘p summa: ${(await loadCashMaxOrderSom()).toLocaleString('en-US').replace(/,/g, ' ')} so‘m.`,
    'O‘chirsangiz ham, allaqachon berilgan naqd buyurtmalar davom etadi.',
  ].join('\n');
  return { text, keyboard: Markup.inlineKeyboard([[on ? Markup.button.callback('⛔ O‘chirish', 'cash:set:0') : Markup.button.callback('▶️ Yoqish', 'cash:set:1')]]) };
}

export async function renderTaxiMode(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const mode = await loadTaxiMode();
  const mark = (m: TaxiDispatchMode) => (mode === m ? '● ' : '');
  const text = [
    '🚕 <b>Taksi qachon chaqiriladi</b>',
    mode === 'READY'
      ? 'Hozir: <b>restoran «Tayyor» bosganda</b>. Haydovchi biroz kech qolishi mumkin, lekin erta kelmaydi.'
      : 'Hozir: <b>taom tayyor bo‘lishidan 4 daqiqa oldin</b> (yoki «Tayyor» bosilsa — o‘sha zahoti). Tayyorlash vaqti endi so‘ralmagani uchun bu rejim restoranning yashirin standart vaqtiga tayanadi; «Tayyor» bosilganda rejimiga qayting.',
    '',
    'Rejim faqat YANGI boshlangan buyurtmalarga ta’sir qiladi: allaqachon yuborilgan so‘rovlar o‘zgarmaydi.',
  ].join('\n');
  // The timed (LEAD) button is gone: nobody states a preparation time any more (2026-10-27). The mode and its code stay for a stored LEAD value.
  return { text, keyboard: Markup.inlineKeyboard([[
    Markup.button.callback(`${mark('READY')}«Tayyor» bosilganda`, 'taxi:set:READY'),
  ]]) };
}

export async function renderRatings(adminId: string): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const o = await platformRatingsOverview({ adminId });
  const lines = ['⭐ <b>Restoran baholari</b>'];
  if (!o.restaurants.length) lines.push('Hali baho yo‘q.');
  for (const r of o.restaurants) {
    lines.push(`• <b>${escapeHtml(r.name)}</b>: ${r.avg ?? '—'} (${r.count} ta) • 30 kun: ${r.last30.avg ?? '—'} (${r.last30.count} ta) • reyting balli ${r.score}`);
  }
  if (o.lowRecent.length) {
    lines.push('', '⚠️ <b>So‘nggi past baholar</b>');
    for (const l of o.lowRecent) {
      const why = l.reasons.map(t => REASON_LABEL[t as RatingReason] ?? t).join(', ');
      lines.push(`• ${escapeHtml(l.restaurant)} — ${'⭐'.repeat(l.stars)}${why ? ` — ${escapeHtml(why)}` : ''}${l.note ? `\n  «${escapeHtml(l.note)}»` : ''}`);
    }
  }
  lines.push('', o.rankingOn ? '📈 Ro‘yxat tartibi: <b>reyting bo‘yicha</b> (yaxshi baholilar tepada).' : '🔤 Ro‘yxat tartibi: <b>alifbo bo‘yicha</b> (baho tartibga ta’sir qilmaydi).');
  lines.push('Mijozga baho 5 ta bahodan keyin ko‘rinadi.');
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard([[Markup.button.callback(o.rankingOn ? '🔤 Alifbo tartibiga qaytish' : '📈 Reyting bo‘yicha tartiblash', `rate:rank:${o.rankingOn ? 0 : 1}`)]]) };
}

const BLOCK_TEXT: Record<string, string> = {
  OPEN_ORDERS: 'tugallanmagan buyurtma bor',
  OPEN_REFUNDS: 'hal qilinmagan pul qaytarish bor',
  OPEN_DISPATCHES: 'javob kutayotgan yoki yo‘ldagi taksi so‘rovi bor',
};

/** What the confirmation screen tells the administrator before anything is touched. */
function removalQuestion(kind: 'r' | 't', plan: RemovalPlan): string | null {
  if (plan.result === 'NOT_FOUND') return null;
  const what = kind === 'r' ? 'restoran' : 'taksi kompaniyasi';
  if (plan.result === 'BLOCKED') return `⛔ <b>${escapeHtml(plan.name)}</b> hozir o‘chirib bo‘lmaydi: ${plan.count} ta ${BLOCK_TEXT[plan.reason]}. Avval ularni tugating yoki bekor qiling.`;
  if (plan.result === 'DELETE') return `🗑 <b>${escapeHtml(plan.name)}</b> (${what}) butunlay o‘chiriladi. Hech qanday buyurtma yoki to‘lov yo‘q. Qaytarib bo‘lmaydi.`;
  return [
    `🗄 <b>${escapeHtml(plan.name)}</b> (${what}) arxivlanadi.`,
    `Unda ${plan.orders} ta yozuv bor (buyurtma, to‘lov, komissiya hisobi o‘chirilmaydi): shuning uchun u o‘chirilib, mijozlarga ko‘rinmay qoladi, kirish yopiladi, nomi bo‘shatiladi.`,
    ...(plan.dueSom > 0 ? [`Komissiya hisobi (${plan.dueSom.toLocaleString('en-US').replace(/,/g, ' ')} so‘m) saqlanadi va /commission da qoladi.`] : []),
  ].join('\n');
}
const removalDone = (o: RemovalOutcome): string =>
  o.result === 'DELETED' ? `🗑 <b>${escapeHtml(o.name)}</b> o‘chirildi.` : o.result === 'ARCHIVED' ? `🗄 <b>${escapeHtml(o.name)}</b> arxivlandi.`
    : o.result === 'BLOCKED' ? `⛔ <b>${escapeHtml(o.name)}</b> o‘chirilmadi: ${o.count} ta ${BLOCK_TEXT[o.reason]}.` : 'Topilmadi.';

export function registerPlatformAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };
  const argsOf = (ctx: Context): string => {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
    return text.replace(/^\/\S+\s*/, '').trim();
  };

  bot.command('payments', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const v = await renderPayments();
    await ctx.reply(v.text, { parse_mode: 'HTML', ...(v.keyboard ? { reply_markup: v.keyboard.reply_markup } : {}) });
  });

  bot.command('fee', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const arg = argsOf(ctx).replace(',', '.');
    const amount = /^som\s+(\d{4,5})$/i.exec(arg);
    if (amount) {
      // /fee som 5000: the amount of the separate platform line (it keeps whatever "chegirma" state it has)
      try { await setFeeMode({ adminId, mode: 'LINE', lineSom: Number(amount[1]) }); } catch { await ctx.reply('Summa 1 000 dan 50 000 gacha bo‘lsin: <code>/fee som 5000</code>', { parse_mode: 'HTML' }); return; }
    } else if (arg) {
      const pct = Number(arg);
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(arg) || !(pct >= 1 && pct <= 25)) { await ctx.reply('Foizni 1 dan 25 gacha yozing: <code>/fee 8</code>', { parse_mode: 'HTML' }); return; }
      await setFeeMode({ adminId, mode: 'PERCENT', percentBp: Math.round(pct * 100) });
    }
    const v = await renderFee();
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
  });

  // 1+1 promotions (owner decision 2026-11-01): /aksiya lists them; on/off switch one; taomlar sets its dishes; limit caps the free units of one order.
  bot.command('aksiya', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const words = argsOf(ctx).split(/\s+/);
    const [sub, ref] = words;
    const tail = words.slice(2).join(' ');
    try {
      if (sub === 'on' || sub === 'off') {
        const r = await setPromotionActive(adminId, ref ?? '', sub === 'on');
        await ctx.reply(`${r.isActive ? '🟢 Yoqildi' : '⚪ O‘chirildi'}: <b>${escapeHtml(r.title)}</b>`, { parse_mode: 'HTML' });
      } else if (sub === 'taomlar') {
        const r = await setPromotionProducts(adminId, ref ?? '', tail.split(/[;\n]/));
        await ctx.reply(`✅ <b>${escapeHtml(r.title)}</b> taomlari:\n${r.products.map(n => `• ${escapeHtml(n)}`).join('\n')}`, { parse_mode: 'HTML' });
      } else if (sub === 'limit') {
        const r = await setPromotionCap(adminId, ref ?? '', Number(words[2]));
        await ctx.reply(`✅ <b>${escapeHtml(r.title)}</b>: ${r.cap === null ? 'bitta buyurtmada bepul donalar cheklanmagan' : `bitta buyurtmada eng ko‘pi bilan ${r.cap} ta bepul`}`, { parse_mode: 'HTML' });
      }
    } catch (e) {
      const m = e as Error & { missing?: string[] };
      const text = m.message === 'AKSIYA_TOPILMADI' ? 'Aksiya topilmadi. Kodni /aksiya ro‘yxatidan oling.'
        : m.message === 'AKSIYADA_TAOM_YOQ' ? 'Avval taomlarni belgilang: <code>/aksiya taomlar KOD Taom 1; Taom 2</code>'
        : m.message === 'TAOM_TOPILMADI' ? `Bu taomlar menyuda topilmadi: ${(m.missing ?? []).map(escapeHtml).join(', ')}. Nomni menyudagidek yozing.`
        : m.message === 'TAOM_NOMLARI_NOTOGRI' ? 'Taom nomlarini «;» bilan ajratib yozing.'
        : m.message === 'SON_NOTOGRI' ? 'Son 0 dan 100 gacha (0 = cheklovsiz).'
        : 'Bajarilmadi.';
      await ctx.reply(text, { parse_mode: 'HTML' });
      return;
    }
    const list = await listPromotionsForAdmin(adminId);
    await ctx.reply(list.length === 0 ? 'Aksiyalar yo‘q.' : [
      '🎁 <b>Aksiyalar (1+1)</b>',
      ...list.map(p => `\n${p.isActive ? '🟢' : '⚪'} <b>${escapeHtml(p.title)}</b> — ${escapeHtml(p.restaurant)}\nKod: <code>${p.ref}</code>${p.maxFreePerOrder ? ` • limit: ${p.maxFreePerOrder} ta/buyurtma` : ''}${p.bannerOn ? ' • slayd bor' : ''}\nTaomlar: ${p.products.length ? p.products.map(escapeHtml).join(', ') : '— belgilanmagan'}`),
      '',
      '<code>/aksiya on KOD</code> • <code>/aksiya off KOD</code>',
      '<code>/aksiya taomlar KOD Taom 1; Taom 2</code>',
      '<code>/aksiya limit KOD 4</code> (0 = cheklovsiz)',
    ].join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('taxi', async ctx => {
    if (!admin(ctx)) return;
    const v = await renderTaxiMode();
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
  });

  bot.action(/^taxi:set:(READY|LEAD)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    await setTaxiMode({ adminId, mode: (ctx.match as unknown as [string, TaxiDispatchMode])[1] });
    const v = await renderTaxiMode();
    await ctx.editMessageText(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup }).catch(() => undefined);
  });

  bot.command('ratings', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const v = await renderRatings(adminId);
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
  });

  bot.action(/^rate:rank:([01])$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    await setRankingEnabled({ adminId, enabled: (ctx.match as unknown as [string, string])[1] === '1' });
    const v = await renderRatings(adminId);
    await ctx.editMessageText(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup }).catch(() => undefined);
  });

  bot.command('cash', async ctx => {
    if (!admin(ctx)) return;
    const v = await renderCash();
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
  });

  bot.action(/^cash:set:([01])$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    await setCashEnabled({ adminId, enabled: (ctx.match as unknown as [string, string])[1] === '1' });
    const v = await renderCash();
    await ctx.editMessageText(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup }).catch(() => undefined);
  });

  bot.action(/^fee:set:(FREE|FLAT|LINE|PERCENT|TIERED)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const pick = (ctx.match as unknown as [string, string])[1];
    // FREE (and an old FLAT button still sitting in an earlier chat message) = the platform line crossed out as a discount: nobody is charged.
    if (pick === 'FREE' || pick === 'FLAT') await setFeeMode({ adminId, mode: 'LINE', lineWaived: true });
    else if (pick === 'LINE') await setFeeMode({ adminId, mode: 'LINE', lineWaived: false });
    else await setFeeMode({ adminId, mode: pick as FeeMode });
    const v = await renderFee();
    await ctx.editMessageText(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup }).catch(() => undefined);
  });

  bot.action(/^pay:(ask|go|back):?([01])?$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const [, step, flag] = ctx.match as unknown as [string, 'ask' | 'go' | 'back', '0' | '1' | undefined];
    const edit = (text: string, keyboard?: ReturnType<typeof Markup.inlineKeyboard> | null) =>
      ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}) }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    if (step === 'back') { const v = await renderPayments(); await edit(v.text, v.keyboard); return; }
    const open = flag === '1';
    if (step === 'ask') {
      await edit(
        open ? '▶️ <b>Real to‘lovni yoqasizmi?</b>\nMijozlar shu daqiqadan haqiqiy pul to‘lay boshlaydi.' : '⛔ <b>Real to‘lovni yopasizmi?</b>\nYangi buyurtma olinmaydi.',
        Markup.inlineKeyboard([[Markup.button.callback(open ? '✅ Ha, yoqaman' : '✅ Ha, yopaman', `pay:go:${open ? 1 : 0}`), Markup.button.callback('⬅️ Orqaga', 'pay:back')]]),
      );
      return;
    }
    const r = await setRealPaymentsOpen({ adminId, open });
    if (r.result === 'BLOCKED') { await edit(['Yoqib bo‘lmadi:', ...r.blockers.map(b => `• ${escapeHtml(b)}`)].join('\n')); return; }
    await edit(r.result === 'CHANGED' ? (open ? '🟢 Real to‘lov <b>ochildi</b>.' : '🔴 Real to‘lov <b>yopildi</b>.') : 'Holat o‘zgarmadi.');
    if (r.result === 'CHANGED') {
      let others: string[] = [];
      try { others = supportAdminIds().filter(id => id !== adminId); } catch { /* none configured */ }
      for (const id of others) {
        await bot.telegram.sendMessage(id, open ? '🟢 Real to‘lov ochildi (boshqa administrator).' : '🔴 Real to‘lov yopildi (boshqa administrator).').catch(() => undefined);
      }
    }
  });

  /** Downloads a Telegram file the administrator sent (never more than `max` bytes). Null when it is missing, too big or cannot be fetched. */
  const downloadFile = async (ctx: Context, fileId: string, declaredSize: number | undefined, max: number): Promise<Buffer | null> => {
    if (declaredSize !== undefined && declaredSize > max) return null;
    try {
      const url = await ctx.telegram.getFileLink(fileId);
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      return bytes.length <= max ? bytes : null;
    } catch { return null; }
  };

  const newRestaurant = async (ctx: Context, adminId: string, args: string, image?: Buffer) => {
    const [name, address, phone] = args.split('|').map(s => s.trim());
    if (!name || !address) {
      await ctx.reply('Yozing:\n<code>/newrestaurant Nomi | Manzil | +998901234567</code>\n(telefon ixtiyoriy)\nRasm bilan: rasmni yuboring va izohiga shu matnni yozing.', { parse_mode: 'HTML' });
      return;
    }
    try {
      const r = await createRestaurantByAdmin({ adminId, name, pickupAddress: address, pickupPhone: phone || undefined, image });
      await ctx.reply([
        `✅ <b>${escapeHtml(r.name)}</b> qo‘shildi.${r.hasImage ? ' 🖼 Rasm qo‘yildi.' : ''}`,
        ...(r.hasImage ? [] : ['Rasm yo‘q: qo‘shish uchun rasmni yuboring va izohiga <code>/restaurantphoto ' + escapeHtml(r.slug) + '</code> deb yozing.']),
        `Restoran kodi: <code>${escapeHtml(r.slug)}</code>`,
        `Parol: <code>${escapeHtml(r.password)}</code>`,
        '',
        'Parol faqat shu yerda ko‘rsatiladi: xodimga o‘zingiz yetkazing. Yo‘qolsa: <code>/resetpassword ' + escapeHtml(r.slug) + '</code>',
        'Restoran to‘xtatilgan holda boshlandi: xodim menyu va karta qo‘shgach “Buyurtma qabul qilish”ni yoqadi.',
        `Telegram xabarlari uchun: <code>/linkstaff ${escapeHtml(r.slug)} TELEGRAM_ID</code>`,
      ].join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      await ctx.reply(m === 'TELEFON_NOTOGRI' ? 'Telefon raqami noto‘g‘ri.' : m === 'RASM_NOTOGRI' ? 'Rasm yaroqsiz (JPG, PNG yoki WebP, 3 MB gacha).' : m === 'NOM_QISQA' || m === 'MANZIL_QISQA' ? 'Nom yoki manzil juda qisqa.' : 'Qo‘shib bo‘lmadi.');
    }
  };

  bot.command('newrestaurant', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    await newRestaurant(ctx, adminId, argsOf(ctx));
  });

  const restaurantPhoto = async (ctx: Context, adminId: string, slug: string, fileId: string, size: number | undefined) => {
    const bytes = await downloadFile(ctx, fileId, size, IMAGE_MAX_BYTES);
    if (!bytes) { await ctx.reply('Rasmni olib bo‘lmadi (3 MB dan katta yoki yuklanmadi). Qayta yuboring.'); return; }
    try {
      const r = await setRestaurantImage({ adminId, slug, bytes });
      await ctx.reply(r ? `🖼 <b>${escapeHtml(r.name)}</b> rasmi yangilandi.` : 'Bunday restoran yo‘q. Kodni /restaurants dan ko‘ring.', { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(err instanceof Error && err.message === 'RASM_NOTOGRI' ? 'Rasm yaroqsiz (JPG, PNG yoki WebP, 3 MB gacha).' : 'Saqlab bo‘lmadi.');
    }
  };
  const photoHelp = 'Restoran rasmi: rasmni yuboring va izohiga <code>/restaurantphoto restoran-kodi</code> deb yozing (yoki rasmga javob sifatida shu buyruqni yuboring). Kodni /restaurants dan ko‘ring.';

  bot.command('restaurantphoto', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const slug = argsOf(ctx).split(/\s+/)[0] ?? '';
    const replied = ctx.message.reply_to_message as { photo?: Array<{ file_id: string; file_size?: number }> } | undefined;
    const largest = replied?.photo?.at(-1);
    if (!slug || !largest) { await ctx.reply(photoHelp, { parse_mode: 'HTML' }); return; }
    await restaurantPhoto(ctx, adminId, slug, largest.file_id, largest.file_size);
  });

  // A photo whose caption is /newrestaurant ... or /restaurantphoto <code> (a caption is not a text message, so bot.command does not see it).
  bot.on(['photo', 'document'], async (ctx, next) => {
    const adminId = admin(ctx);
    const msg = ctx.message as { caption?: string; photo?: Array<{ file_id: string; file_size?: number }>; document?: { file_id: string; file_size?: number; mime_type?: string } };
    const caption = msg.caption?.trim() ?? '';
    const command = /^\/(newrestaurant|restaurantphoto)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(caption);
    if (!adminId || !command) return next();
    const file = msg.photo?.at(-1) ?? (msg.document?.mime_type?.startsWith('image/') ? msg.document : undefined);
    if (!file) { await ctx.reply('Rasm yuboring (oddiy rasm yoki JPG/PNG/WebP fayl).'); return; }
    const args = (command[2] ?? '').trim();
    if (command[1]!.toLowerCase() === 'restaurantphoto') {
      const slug = args.split(/\s+/)[0] ?? '';
      if (!slug) { await ctx.reply(photoHelp, { parse_mode: 'HTML' }); return; }
      await restaurantPhoto(ctx, adminId, slug, file.file_id, file.file_size);
      return;
    }
    const bytes = await downloadFile(ctx, file.file_id, file.file_size, IMAGE_MAX_BYTES);
    if (!bytes) { await ctx.reply('Rasmni olib bo‘lmadi (3 MB dan katta yoki yuklanmadi). Qayta yuboring.'); return; }
    await newRestaurant(ctx, adminId, args, bytes);
  });

  bot.command('resetpassword', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const slug = argsOf(ctx).split(/\s+/)[0] ?? '';
    if (!slug) { await ctx.reply('Yozing: <code>/resetpassword restoran-kodi</code>', { parse_mode: 'HTML' }); return; }
    const r = await resetRestaurantPasswordByAdmin({ adminId, slug });
    if (!r) { await ctx.reply('Bunday restoran yo‘q.'); return; }
    await ctx.reply(`🔑 <b>${escapeHtml(r.name)}</b>\nYangi parol: <code>${escapeHtml(r.password)}</code>\nEski parol va barcha kirgan qurilmalar o‘chirildi.`, { parse_mode: 'HTML' });
  });

  bot.command('newtaxi', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const name = argsOf(ctx);
    if (!name) { await ctx.reply('Yozing:\n<code>/newtaxi Taksi kompaniya nomi</code>', { parse_mode: 'HTML' }); return; }
    try {
      const r = await createTaxiCompanyByAdmin({ adminId, name });
      await ctx.reply([
        `✅ <b>${escapeHtml(r.name)}</b> taksi kompaniyasi qo‘shildi.`,
        `Login: <code>${escapeHtml(r.login)}</code>`,
        `Parol: <code>${escapeHtml(r.password)}</code>`,
        '',
        'DS Taxi ilovasiga shu login va parol bilan kiriladi. Parol faqat shu yerda ko‘rsatiladi: operatorga o‘zingiz yetkazing.',
        `Yo‘qolsa: <code>/taxiapp ${escapeHtml(r.login)}</code>`,
      ].join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      await ctx.reply(m === 'KOMPANIYA_BOR' ? 'Bunday nomli kompaniya bor. Parol uchun: /taxiapp Nomi' : m === 'NOM_QISQA' ? 'Nom juda qisqa.' : 'Qo‘shib bo‘lmadi.');
    }
  });

  bot.command('taxiapp', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const ref = argsOf(ctx);
    if (!ref) { await ctx.reply('Yozing: <code>/taxiapp login</code> yoki <code>/taxiapp Kompaniya nomi</code>\nYangi parol beriladi, eski parol va kirgan qurilmalar o‘chadi.', { parse_mode: 'HTML' }); return; }
    const r = await resetTaxiAccessByAdmin({ adminId, ref });
    if (!r) { await ctx.reply('Bunday taksi kompaniyasi yo‘q.'); return; }
    await ctx.reply(`🔑 <b>${escapeHtml(r.name)}</b>\nLogin: <code>${escapeHtml(r.login)}</code>\nYangi parol: <code>${escapeHtml(r.password)}</code>\nEski parol va barcha kirgan qurilmalar o‘chirildi.`, { parse_mode: 'HTML' });
  });

  // ---- remove a test restaurant / taxi company (two taps; deleted if it has no history, archived otherwise) ----
  bot.command('deleterestaurant', async ctx => {
    if (!admin(ctx)) return;
    const rows = await db.restaurant.findMany({ where: { NOT: { slug: { startsWith: 'arxiv-' } } }, orderBy: { name: 'asc' }, take: 40, select: { id: true, name: true, slug: true } });
    if (!rows.length) { await ctx.reply('O‘chiriladigan restoran yo‘q.'); return; }
    await ctx.reply('Qaysi restoranni o‘chiramiz?', Markup.inlineKeyboard(rows.map(r => [Markup.button.callback(`${r.name} (${r.slug})`.slice(0, 60), `rm:r:ask:${r.id}`)])));
  });
  bot.command('deletetaxi', async ctx => {
    if (!admin(ctx)) return;
    const rows = await db.taxiCompany.findMany({ where: { NOT: { name: { contains: '[arxiv' } } }, orderBy: { name: 'asc' }, take: 40, select: { id: true, name: true } });
    if (!rows.length) { await ctx.reply('O‘chiriladigan taksi kompaniyasi yo‘q.'); return; }
    await ctx.reply('Qaysi taksi kompaniyasini o‘chiramiz?', Markup.inlineKeyboard(rows.map(r => [Markup.button.callback(r.name.slice(0, 60), `rm:t:ask:${r.id}`)])));
  });
  bot.action(/^rm:(r|t):(ask|go):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const [, kind, step, id] = ctx.match as unknown as [string, 'r' | 't', 'ask' | 'go', string];
    const edit = (text: string, keyboard?: ReturnType<typeof Markup.inlineKeyboard>) =>
      ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}) }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    if (step === 'ask') {
      const plan = kind === 'r' ? await planRestaurantRemoval(adminId, id) : await planTaxiRemoval(adminId, id);
      const q = removalQuestion(kind, plan);
      if (!q) { await edit('Topilmadi (allaqachon o‘chirilgan bo‘lishi mumkin).'); return; }
      await edit(q, plan.result === 'DELETE' || plan.result === 'ARCHIVE'
        ? Markup.inlineKeyboard([[Markup.button.callback(plan.result === 'DELETE' ? '🗑 Ha, o‘chiraman' : '🗄 Ha, arxivlayman', `rm:${kind}:go:${id}`)], [Markup.button.callback('⬅️ Yo‘q', 'rm:cancel:x:0')]])
        : undefined);
      return;
    }
    const outcome = kind === 'r' ? await removeRestaurant({ adminId, restaurantId: id }) : await removeTaxiCompany({ adminId, companyId: id });
    await edit(removalDone(outcome));
    if (outcome.result === 'DELETED' || outcome.result === 'ARCHIVED') {
      let others: string[] = [];
      try { others = supportAdminIds().filter(x => x !== adminId); } catch { /* none configured */ }
      for (const other of others) await bot.telegram.sendMessage(other, `ℹ️ Administrator: ${removalDone(outcome).replace(/<[^>]+>/g, '')}`).catch(() => undefined);
    }
  });
  bot.action('rm:cancel:x:0', async ctx => { await ctx.answerCbQuery().catch(() => undefined); await ctx.editMessageText('Bekor qilindi. Hech narsa o‘zgarmadi.').catch(() => undefined); });

  // ---- "sinov" (owner request 2026-11-06): a fake order in a restaurant's own app / a fake request in a taxi operator's app, to explain them. Nothing reaches history, money or a real driver. ----
  bot.command('demo', async ctx => {
    if (!admin(ctx)) return;
    await ctx.reply([
      '🧪 <b>Sinov</b>',
      'Kimga ko‘rsatamiz? Ilovada oddiy buyurtmadek ko‘rinadi, tugmalarni bosib ko‘rish mumkin.',
      'Pul yo‘q, haqiqiy haydovchiga so‘rov ketmaydi, tarix va hisobotga yozilmaydi.',
    ].join('\n'), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🍽 Restoran xodimiga', 'demo:menu:r'), Markup.button.callback('🚕 Taksi operatoriga', 'demo:menu:t')]]).reply_markup });
  });
  bot.action(/^demo:(menu|send|end|tsend|tend):([a-zA-Z0-9_-]+)(?::([ck]))?$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    if (!admin(ctx)) return;
    const [, step, id, pay] = ctx.match as unknown as [string, 'menu' | 'send' | 'end' | 'tsend' | 'tend', string, 'c' | 'k' | undefined];
    const edit = (text: string, keyboard?: ReturnType<typeof Markup.inlineKeyboard>) =>
      ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}) }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    if (step === 'menu' && id === 'r') {
      const rows = await db.restaurant.findMany({ where: { NOT: { slug: { startsWith: 'arxiv-' } } }, orderBy: { name: 'asc' }, take: 40, select: { id: true, name: true } });
      if (!rows.length) { await edit('Restoran yo‘q.'); return; }
      await edit('🍽 Qaysi restoran ilovasiga sinov buyurtma yuboramiz?', Markup.inlineKeyboard(rows.map(r => [Markup.button.callback(r.name.slice(0, 60), `demo:send:${r.id}`)])));
      return;
    }
    if (step === 'menu') {
      const rows = await db.taxiCompany.findMany({ where: { NOT: { name: { contains: '[arxiv' } } }, orderBy: { name: 'asc' }, take: 40, select: { id: true, name: true } });
      if (!rows.length) { await edit('Taksi kompaniyasi yo‘q.'); return; }
      await edit('🚕 Qaysi taksi kompaniyasi ilovasiga sinov so‘rov yuboramiz?', Markup.inlineKeyboard(rows.map(r => [Markup.button.callback(r.name.slice(0, 60), `demo:tsend:${r.id}`)])));
      return;
    }
    if (step === 'tsend' && !pay) {
      // second question: how the fake order was paid (it changes what the operator sees: the cash line for the driver)
      await edit('To‘lov turi qanday ko‘rsatilsin?', Markup.inlineKeyboard([[Markup.button.callback('💳 Karta (to‘langan)', `demo:tsend:${id}:k`), Markup.button.callback('💵 Naqd (haydovchi to‘laydi)', `demo:tsend:${id}:c`)]]));
      return;
    }
    if (step === 'tsend') {
      const r = await createTaxiDemoRequest(id, pay === 'c');
      if (r.result === 'NOT_FOUND') { await edit('Taksi kompaniyasi topilmadi.'); return; }
      if (r.result === 'BUSY') { await edit('Hozir band, yana bir marta urinib ko‘ring.'); return; }
      await edit([
        `🚕 <b>${escapeHtml(r.companyName)}</b> ilovasiga sinov so‘rov yuborildi: <b>${escapeHtml(r.code)}</b>.`,
        'Operatorga ilovani ochishni ayting: so‘rov yangi buyurtmadek turadi va qo‘ng‘iroq chalinadi. «Qabul qildim» → «Taksi yuborildi» → «Yetkazildi» ni bosib ko‘rsatsin. Haydovchi bu so‘rovdan xabar topmaydi.',
        `Oxirigacha bosilsa yoki «Taksi yo‘q» bosilsa o‘zi o‘chadi, bosilmasa ${Math.round(DEMO_TAXI_MAX_AGE_MS / 60_000)} daqiqada.`,
      ].join('\n'), Markup.inlineKeyboard([[Markup.button.callback('🗑 Tugatish', `demo:tend:${id}`)]]));
      return;
    }
    if (step === 'tend') {
      const n = await removeTaxiDemoRequest(id);
      await edit(n ? '🗑 Sinov so‘rov o‘chirildi.' : 'Sinov so‘rov allaqachon yo‘q.');
      return;
    }
    if (step === 'end') {
      const n = await removeDemoOrders(id);
      await edit(n ? '🗑 Sinov buyurtma o‘chirildi.' : 'Sinov buyurtma allaqachon yo‘q.');
      return;
    }
    const r = await createDemoOrder(id);
    if (r.result === 'NOT_FOUND') { await edit('Restoran topilmadi.'); return; }
    await edit([
      `🧪 <b>${escapeHtml(r.restaurantName)}</b> ilovasiga sinov buyurtma yuborildi: <b>#${escapeHtml(r.code)}</b> (${r.totalSom.toLocaleString('en-US').replace(/,/g, ' ')} so‘m).`,
      'Xodimga ilovani ochishni ayting: «Yangi» bo‘limida turibdi, qo‘ng‘iroq ham chalinadi.',
      `Unda faqat «Qabul qildim» va «Tayyor» ishlaydi. Tayyor bosilgach 5 daqiqada, bosilmasa ${Math.round(DEMO_MAX_AGE_MS / 60_000)} daqiqada o‘zi o‘chadi.`,
    ].join('\n'), Markup.inlineKeyboard([[Markup.button.callback('🗑 Tugatish', `demo:end:${id}`)]]));
  });

  bot.command('linkstaff', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const [slug, tid] = argsOf(ctx).split(/\s+/);
    if (!slug || !tid) { await ctx.reply('Yozing: <code>/linkstaff restoran-kodi TELEGRAM_ID</code>', { parse_mode: 'HTML' }); return; }
    try {
      const r = await linkStaffByAdmin({ adminId, slug, telegramId: tid });
      await ctx.reply(r.result === 'LINKED' ? `✅ ${escapeHtml(r.name)}: yangi buyurtma xabarlari shu Telegramga boradi. Xodim botda /start bosgan bo‘lsin.`
        : r.result === 'TAKEN' ? `Bu Telegram boshqa restoranga (${escapeHtml(r.otherSlug)}) bog‘langan.` : 'Bunday restoran yo‘q.', { parse_mode: 'HTML' });
    } catch { await ctx.reply('Telegram ID faqat raqamlardan iborat bo‘lsin.'); }
  });
}
