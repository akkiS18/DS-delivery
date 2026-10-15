/** Pure helpers for Telegram checkout. No database or network dependencies. */
export function normalizeUzPhone(input: string): string | null {
  const stripped = input.replace(/[\s()\-]/g, '');
  const match = stripped.match(/^(?:\+?998)?(\d{9})$/);
  return match ? `+998${match[1]}` : null;
}

export function checkoutSummary(data: {
  restaurant: string; phone: string; address: string; taxi: string;
  amountSom: number; mock: boolean;
}): string {
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const format = (amount: number) => `${new Intl.NumberFormat('uz-UZ').format(amount)} so‘m`;
  return `🧾 <b>Buyurtmani tekshiring</b>\n\n` +
    `🏪 ${safe(data.restaurant)}\n` +
    `📞 ${safe(data.phone)}\n` +
    `📍 ${safe(data.address)}\n` +
    `🚕 ${safe(data.taxi)}\n\n` +
    `Taomlar: <b>${format(data.amountSom)}</b>\n` +
    `Yetkazish: <b>Taksi tarifi bo‘yicha, alohida to‘lanadi</b>\n\n` +
    (data.mock ? '🧪 <b>SINOV REJIMI:</b> haqiqiy pul yubormang.\n' :
      '⚠️ Taom puli restoranga bevosita to‘lanadi. Yetkazish narxini taksi xizmati belgilaydi.\n') +
    'Tasdiqlasangiz, buyurtma va to‘lov so‘rovi yaratiladi.';
}
