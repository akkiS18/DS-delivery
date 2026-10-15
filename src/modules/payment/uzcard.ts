/** Parser for the OBSERVED UZCARD incoming email format. Not a bank API. */
export type ParsedUzcard = {
  cardLast4: string;
  amountTiyin: bigint;
  occurredAt: Date;
  operation: string;
  minutePrecision: true;
};

export function parseUzcardEmail(raw: string): ParsedUzcard | null {
  const text = raw.replace(/\s+/g, ' ');
  const operation = text.match(/\bPerevod\s+na\s+kartu\s*:\s*([^,]+),/i);
  const timestamp = text.match(/\b(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})\s*,\s*karta\s*\*+(\d{4})\b/i);
  const amount = text.match(/\bsumma\s*:\s*(\d+(?:[.,]\d{1,2})?)\s*UZS\b/i);
  if (!operation || !timestamp || !amount) return null;

  const [, dd, mm, yy, hh, min, cardLast4] = timestamp;
  const [, whole, fractional = ''] = amount[1].replace(',', '.').match(/^(\d+)(?:\.(\d{1,2}))?$/) ?? [];
  if (!whole) return null;
  const amountTiyin = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (amountTiyin <= 0n) return null;

  const local = `20${yy}-${mm}-${dd}T${hh}:${min}`;
  // UZCARD message prints minute precision in Uzbekistan (+05:00), no seconds.
  const occurredAt = new Date(`${local}:00+05:00`);
  if (Number.isNaN(occurredAt.getTime())) return null;
  if (new Date(occurredAt.getTime() + 5 * 3600_000).toISOString().slice(0, 16) !== local) return null;
  return { cardLast4, amountTiyin, occurredAt, operation: operation[1].trim(), minutePrecision: true };
}

export function parseSom(input: string): bigint {
  if (!/^\d+$/.test(input)) throw new Error('Summani butun so‘mda kiriting: order 21000');
  const amount = BigInt(input);
  if (amount < 1n || amount > 100_000_000_000n) throw new Error('Summa ruxsat etilgan oraliqda emas.');
  return amount * 100n;
}

export function formatSom(tiyin: bigint): string {
  const som = tiyin / 100n;
  const cents = tiyin % 100n;
  return `${som.toLocaleString('en-US')}${cents ? `.${String(cents).padStart(2, '0')}` : ''} so‘m`;
}

export function sampleUzcardEmail(last4: string, tiyin: bigint, occurredAt = new Date()): string {
  const t = new Date(occurredAt.getTime() + 5 * 3600_000);
  const pad = (x: number): string => String(x).padStart(2, '0');
  const date = `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${String(t.getUTCFullYear()).slice(-2)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return `Hurmatli mijoz Sizning kartangizda quyidagi amaliyot bajarildi: Perevod na kartu: UB VISA TO UZCARD, UZ,${date},karta ***${last4}. summa:${(tiyin / 100n).toString()}.${(tiyin % 100n).toString().padStart(2, '0')} UZS balans:3000.00 UZS Hurmat bilan, UZCARD texnik yordam xizmati`;
}
