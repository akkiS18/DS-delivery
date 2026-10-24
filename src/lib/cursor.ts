import { z } from 'zod';

/**
 * Opaque paging cursor for lists shown to restaurants: (timestamp, id) of the last row of the previous page.
 * It deliberately carries no sequence number, so paging never reveals how many orders the platform has.
 */
export const cursorParam = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}.${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { at: Date; id: string } {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const dot = text.indexOf('.');
  const ms = Number(text.slice(0, dot));
  const id = text.slice(dot + 1);
  if (dot < 1 || !Number.isSafeInteger(ms) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Object.assign(new Error('BAD_CURSOR'), { statusCode: 400 });
  return { at: new Date(ms), id };
}

/** Rows strictly older than the cursor when ordered by (field desc, id desc). */
export function beforeCursor<F extends string>(field: F, raw: string): { OR: Array<Record<string, unknown>> } {
  const c = decodeCursor(raw);
  return { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] };
}
