import { supportAdminIds } from '../modules/support/service.js';
import { formatSom } from '../modules/payment/uzcard.js';
import type { GmailAlert } from '../modules/payment/gmail.js';
import { explainReason } from '../modules/payment/review-reasons.js';

const DOWN_HINT: Record<string, string> = {
  auth: 'Google ruxsati tugagan yoki bekor qilingan: tokenni lokal kompyuterda yangilab, serverga qayta joylang.',
  network: 'Google bilan aloqa yo‘q (tarmoq).',
  config: 'Gmail sozlamasi yoki token fayli yo‘q/buzilgan.',
  api: 'Gmail API xato qaytaryapti.',
};

/** Admin text for a Gmail event. Only amounts, the last 4 digits and reason codes: never mail bodies, addresses or tokens. */
export function renderGmailAlert(a: GmailAlert): string {
  if (a.type === 'DOWN') {
    return `🚨 Gmail o‘qilmayapti. To‘lovlar avtomatik tasdiqlanmaydi!\n${DOWN_HINT[a.failure] ?? DOWN_HINT.api}\nMijozlar to‘lagan bo‘lsa, restoran bank ilovasini qo‘lda tekshirsin.`;
  }
  if (a.type === 'RECOVERED') return '✅ Gmail o‘qish tiklandi.';
  return `⚠️ Pul keldi, lekin mos to‘lov topilmadi.\nSumma: ${formatSom(a.amountTiyin)} | karta ***${a.cardLast4}\nSabab: ${explainReason(a.reason)} (${a.reason})\nKo‘rish va hal qilish: /money`;
}

/** Sends a Gmail alert to every support admin. Best effort: a Telegram failure is logged and never thrown. */
export function gmailAlertSender(bot: { telegram: { sendMessage(chatId: string, text: string): Promise<unknown> } } | undefined, log: (line: string) => void = console.error): (a: GmailAlert) => Promise<void> {
  return async a => {
    const text = renderGmailAlert(a);
    let admins: string[] = [];
    try { admins = supportAdminIds(); } catch { admins = []; }
    if (!bot || !admins.length) { log(`[GMAIL ALERT, no admin channel] ${a.type}`); return; }
    for (const id of admins) {
      try { await bot.telegram.sendMessage(id, text); }
      catch (err) { log(`[GMAIL ALERT] send failed: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`); }
    }
  };
}
