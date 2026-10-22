import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Refund receipt photo. The restaurant proves a refund was sent with ONE image of the bank receipt. The bytes are kept on the server volume
 * (RECEIPT_DIR) under a random name; the database only stores the key, type, size and SHA-256 (see migration 20261030000100_refund_receipt).
 * No image library is used: the type is decided by the file's magic bytes (the client's Content-Type and filename are never trusted), and the
 * file is served back only with that sniffed type, `nosniff` and as a base64 JSON payload, never from a public path.
 */
export const RECEIPT_MIN_BYTES = 1024;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptMime = (typeof RECEIPT_TYPES)[number];
const EXT: Record<ReceiptMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export interface StoredReceipt { key: string; mime: ReceiptMime; bytes: number; sha256: string }

export const receiptDir = (env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(env.RECEIPT_DIR?.trim() || path.join(process.cwd(), 'data', 'receipts'));

/** Pure: JPEG (FF D8 FF), PNG (89 'PNG' CR LF 1A LF) or WebP ('RIFF'....'WEBP'); anything else is not accepted. */
export function sniffImage(buf: Buffer): ReceiptMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Pure validation. Throws CHEK_RASMI_NOTOGRI (400 for the API). */
export function validateReceipt(buf: unknown): { mime: ReceiptMime; sha256: string } {
  if (!Buffer.isBuffer(buf) || buf.length < RECEIPT_MIN_BYTES || buf.length > RECEIPT_MAX_BYTES) throw new Error('CHEK_RASMI_NOTOGRI');
  const mime = sniffImage(buf);
  if (!mime) throw new Error('CHEK_RASMI_NOTOGRI');
  return { mime, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Writes the file atomically (temp name, then rename) with owner-only permissions. The caller removes it again if the database refuses. */
export async function storeReceipt(buf: Buffer, dir = receiptDir()): Promise<StoredReceipt> {
  const { mime, sha256 } = validateReceipt(buf);
  const key = `${randomUUID()}.${EXT[mime]}`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${key}.part`);
  await writeFile(tmp, buf, { mode: 0o600 });
  await rename(tmp, path.join(dir, key));
  return { key, mime, bytes: buf.length, sha256 };
}

export async function discardReceipt(key: string, dir = receiptDir()): Promise<void> {
  if (KEY_RE.test(key)) await rm(path.join(dir, key), { force: true });
}

/** Reads a stored receipt. The key must match the generated shape, so no path can be injected. Null when the file is gone. */
export async function readReceipt(key: string, dir = receiptDir()): Promise<Buffer | null> {
  if (!KEY_RE.test(key)) return null;
  return readFile(path.join(dir, key)).catch(() => null);
}
