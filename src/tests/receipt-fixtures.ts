import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Test helpers for the refund receipt photo. Files go to a throw-away directory, never to a real RECEIPT_DIR. */
export function useTempReceiptDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-receipts-'));
  process.env.RECEIPT_DIR = dir;
  return dir;
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A syntactically "PNG-looking" file (magic bytes + random body) of a given size: unique SHA-256 per call. */
export const fakePng = (size = 2048): Buffer => Buffer.concat([PNG_SIG, randomBytes(size)]);
export const fakeJpeg = (size = 2048): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size)]);
