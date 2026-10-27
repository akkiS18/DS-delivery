import { supportAdminIds } from '../modules/support/service.js';
import { formatSom } from '../modules/payment/uzcard.js';
import type { HumoAlert } from '../modules/payment/humo-telegram.js';
import { explainReason } from '../modules/payment/review-reasons.js';

const DOWN_HINT: Record<string, string> = {
  auth: 'Telegram akkaunt sessiyasi yaroqsiz (akkauntdan chiqarilgan): `npm run humo:login` bilan yangi sessiya oling va serverga joylang.',
  bot: 'HUMO_TG_BOT bot emas yoki topilmadi.',
  network: 'Telegram bilan aloqa yo‘q.',
  config: 'Humo Telegram sozlamalari yoki sessiya fayli yo‘q.',
};

/** Admin text for a Humocard-Telegram event. Only amounts, the last 4 digits and reason codes: never message texts or sessions. */
export function renderHumoAlert(a: HumoAlert): string {
  if (a.type === 'DOWN') return `🚨 Humocard xabarlari o‘qilmayapti. Shu karta to‘lovlari ilovada tasdiqlanmasligi mumkin!\n${DOWN_HINT[a.failure] ?? DOWN_HINT.network}\nMijozlar to‘lagan bo‘lsa, restoran bank ilovasini qo‘lda tekshirsin.`;
  if (a.type === 'RECOVERED') return '✅ Humocard xabarlarini o‘qish tiklandi.';
  if (a.type === 'NOTICE') {
    return `ℹ️ Humocard: yangi turdagi xabar (“${a.title || 'sarlavhasiz'}”) qabul qilindi, plyus belgisi bo‘yicha kirim deb hisoblandi.\nSumma: ${formatSom(a.amountTiyin)} | karta ***${a.cardLast4}\n${a.matched ? 'Mos to‘lovga ulandi.' : 'Mos to‘lov topilmadi: /money'}`;
  }
  if (a.type === 'UNREADABLE') return '⚠️ Humocard botidan plyusli xabar keldi, lekin uni o‘qib bo‘lmadi (shakli notanish). Hech narsa hisobga olinmadi: bank ilovasini tekshiring va namunani dasturchiga yuboring.';
  return `⚠️ Pul keldi (Humocard), lekin mos to‘lov topilmadi.\nSumma: ${formatSom(a.amountTiyin)} | karta ***${a.cardLast4}\nSabab: ${explainReason(a.reason)} (${a.reason})\nKo‘rish va hal qilish: /money`;
}

/** Sends a Humo alert to every support admin. Best effort: a Telegram failure is logged and never thrown. */
export function humoAlertSender(bot: { telegram: { sendMessage(chatId: string, text: string): Promise<unknown> } } | undefined, log: (line: string) => void = console.error): (a: HumoAlert) => Promise<void> {
  return async a => {
    const text = renderHumoAlert(a);
    let admins: string[] = [];
    try { admins = supportAdminIds(); } catch { admins = []; }
    if (!bot || !admins.length) { log(`[HUMO ALERT, no admin channel] ${a.type}`); return; }
    for (const id of admins) {
      try { await bot.telegram.sendMessage(id, text); }
      catch (err) { log(`[HUMO ALERT] send failed: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`); }
    }
  };
}
