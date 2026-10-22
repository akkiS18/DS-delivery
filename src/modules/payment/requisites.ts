/** Shared by the customer bot and the Mini App: which payment mode is configured and what a REAL card's payee details are. */
export function paymentMode(env: NodeJS.ProcessEnv = process.env): 'MOCK' | 'REAL' {
  return env.BOT_PAYMENT_MODE === 'REAL' ? 'REAL' : 'MOCK';
}

/**
 * The 16-digit number customers must pay to, taken ONLY from operator configuration (BOT_REAL_CARD_NUMBERS_JSON maps a card's last4
 * to its number). Anything missing or inconsistent returns null: callers must then tell the customer not to pay - a recipient is
 * never guessed or invented.
 */
export function realRequisite(last4: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const parsed: unknown = JSON.parse(env.BOT_REAL_CARD_NUMBERS_JSON ?? '{}');
    if (!parsed || typeof parsed !== 'object') return null;
    const value = (parsed as Record<string, unknown>)[last4];
    if (typeof value !== 'string') return null;
    const digits = value.replace(/\s/g, '');
    return /^\d{16}$/.test(digits) && digits.endsWith(last4) ? digits : null;
  } catch { return null; }
}
