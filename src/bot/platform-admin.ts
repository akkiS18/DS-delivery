import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin, supportAdminIds } from '../modules/support/service.js';
import { paymentsPanel, setRealPaymentsOpen } from '../modules/platform/settings.js';
import { cashEnabled, cashMaxOrderSom, setCashEnabled } from '../modules/payment/method.js';
import { loadTaxiMode, setTaxiMode, type TaxiDispatchMode } from '../modules/taxi/mode.js';
import { loadFeeConfig, setFeeMode } from '../modules/pricing/config.js';
import { type FeeConfig, type FeeMode } from '../modules/pricing/fee.js';
import { db } from '../lib/db.js';
import { planRestaurantRemoval, planTaxiRemoval, removeRestaurant, removeTaxiCompany, type RemovalOutcome, type RemovalPlan } from '../modules/platform/removal.js';
import { createTaxiCompanyByAdmin, resetTaxiAccessByAdmin } from '../modules/taxi-app/provision.js';
import { createRestaurantByAdmin, linkStaffByAdmin, resetRestaurantPasswordByAdmin } from '../modules/restaurant/provision.js';

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
  FLAT: 'Tekis 5 000 (restorandan)', PERCENT: 'Foiz', TIERED: 'Pog‘onali (50 000 gacha 10%, keyin 3%)',
};
export async function renderFee(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const c: FeeConfig = await loadFeeConfig();
  const text = [
    '🧾 <b>Xizmat haqi</b>',
    `Hozir: <b>${FEE_LABEL[c.mode]}</b>${c.mode === 'PERCENT' ? ` — ${c.percentBp / 100}%` : ''}`,
    '',
    'Tekis: mijoz restoran narxini to‘laydi, platforma 5 000 ni restorandan oladi.',
    'Foiz / pog‘onali: xizmat haqi taom narxlariga kiritilgan, mijoz yaxlit narx ko‘radi; platforma ulushi buyurtmada qotiriladi va restoran bilan hisob-kitobda yuritiladi.',
    'Rejim faqat YANGI buyurtmalarga ta’sir qiladi.',
    '',
    'Foiz: <code>/fee 8</code> (1–25).',
  ].join('\n');
  const mark = (m: FeeMode) => (c.mode === m ? '● ' : '');
  return { text, keyboard: Markup.inlineKeyboard([[
    Markup.button.callback(`${mark('FLAT')}Tekis`, 'fee:set:FLAT'), Markup.button.callback(`${mark('PERCENT')}Foiz`, 'fee:set:PERCENT'), Markup.button.callback(`${mark('TIERED')}Pog‘onali`, 'fee:set:TIERED'),
  ]]) };
}

export async function renderCash(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const on = await cashEnabled();
  const text = [
    '💵 <b>Naqd to‘lov</b>',
    on ? '🟢 <b>YOQILGAN</b>: mijoz naqd to‘lashni tanlay oladi.' : '🔴 <b>O‘CHIRILGAN</b>: yangi naqd buyurtma olinmaydi.',
    '',
    `Naqd buyurtmani restoran qabul qiladi, taksi operatori summani ko‘radi va pulli haydovchi yuboradi. Eng ko‘p summa: ${cashMaxOrderSom().toLocaleString('en-US').replace(/,/g, ' ')} so‘m.`,
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
      : 'Hozir: <b>taom tayyor bo‘lishidan 4 daqiqa oldin</b> (yoki «Tayyor» bosilsa — o‘sha zahoti).',
    '',
    'Rejim faqat YANGI boshlangan buyurtmalarga ta’sir qiladi: allaqachon yuborilgan so‘rovlar o‘zgarmaydi.',
  ].join('\n');
  return { text, keyboard: Markup.inlineKeyboard([[
    Markup.button.callback(`${mark('READY')}«Tayyor» bosilganda`, 'taxi:set:READY'), Markup.button.callback(`${mark('LEAD')}4 daqiqa oldin`, 'taxi:set:LEAD'),
  ]]) };
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
    if (arg) {
      const pct = Number(arg);
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(arg) || !(pct >= 1 && pct <= 25)) { await ctx.reply('Foizni 1 dan 25 gacha yozing: <code>/fee 8</code>', { parse_mode: 'HTML' }); return; }
      await setFeeMode({ adminId, mode: 'PERCENT', percentBp: Math.round(pct * 100) });
    }
    const v = await renderFee();
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
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

  bot.action(/^fee:set:(FLAT|PERCENT|TIERED)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const mode = (ctx.match as unknown as [string, FeeMode])[1];
    await setFeeMode({ adminId, mode });
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

  bot.command('newrestaurant', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const [name, address, phone] = argsOf(ctx).split('|').map(s => s.trim());
    if (!name || !address) {
      await ctx.reply('Yozing:\n<code>/newrestaurant Nomi | Manzil | +998901234567</code>\n(telefon ixtiyoriy)', { parse_mode: 'HTML' });
      return;
    }
    try {
      const r = await createRestaurantByAdmin({ adminId, name, pickupAddress: address, pickupPhone: phone || undefined });
      await ctx.reply([
        `✅ <b>${escapeHtml(r.name)}</b> qo‘shildi.`,
        `Restoran kodi: <code>${escapeHtml(r.slug)}</code>`,
        `Parol: <code>${escapeHtml(r.password)}</code>`,
        '',
        'Parol faqat shu yerda ko‘rsatiladi: xodimga o‘zingiz yetkazing. Yo‘qolsa: <code>/resetpassword ' + escapeHtml(r.slug) + '</code>',
        'Restoran to‘xtatilgan holda boshlandi: xodim menyu va karta qo‘shgach “Buyurtma qabul qilish”ni yoqadi.',
        `Telegram xabarlari uchun: <code>/linkstaff ${escapeHtml(r.slug)} TELEGRAM_ID</code>`,
      ].join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      await ctx.reply(m === 'TELEFON_NOTOGRI' ? 'Telefon raqami noto‘g‘ri.' : m === 'NOM_QISQA' || m === 'MANZIL_QISQA' ? 'Nom yoki manzil juda qisqa.' : 'Qo‘shib bo‘lmadi.');
    }
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
