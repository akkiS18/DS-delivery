import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { RECEIPT_MAX_BYTES, discardReceipt, readReceipt, sniffImage, storeReceipt, validateReceipt } from './receipts.js';

const png = (n = 2048) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(n)]);
const jpg = (n = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const webp = (n = 2048) => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP', 'latin1'), randomBytes(n)]);

test('the type is decided by the bytes: JPEG, PNG and WebP only', () => {
  assert.equal(sniffImage(jpg()), 'image/jpeg');
  assert.equal(sniffImage(png()), 'image/png');
  assert.equal(sniffImage(webp()), 'image/webp');
  for (const bad of [Buffer.from('%PDF-1.7 ....'), Buffer.from('GIF89a....'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('RIFF....WAVE'), Buffer.alloc(0), Buffer.alloc(2000)]) {
    assert.equal(sniffImage(bad), null);
  }
});

test('size limits: at least 1 KB, at most 5 MB; non-buffers are refused', () => {
  assert.throws(() => validateReceipt(png(10)), /CHEK_RASMI_NOTOGRI/);
  assert.throws(() => validateReceipt(Buffer.concat([png(), Buffer.alloc(RECEIPT_MAX_BYTES)])), /CHEK_RASMI_NOTOGRI/);
  assert.throws(() => validateReceipt('not a buffer'), /CHEK_RASMI_NOTOGRI/);
  assert.throws(() => validateReceipt({ a: 1 }), /CHEK_RASMI_NOTOGRI/);
  assert.equal(validateReceipt(jpg()).mime, 'image/jpeg');
});

test('store / read / discard: random name, owner-only temp, no path injection', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-rcpt-test-'));
  try {
    const body = png(4096);
    const r = await storeReceipt(body, dir);
    assert.match(r.key, /^[0-9a-f-]{36}\.png$/);
    assert.equal(r.bytes, body.length);
    assert.equal(r.sha256.length, 64);
    assert.deepEqual((await readdir(dir)).filter(f => !f.startsWith('.')), [r.key]);
    assert.equal((await readdir(dir)).filter(f => f.endsWith('.part')).length, 0, 'no temp file is left behind');
    assert.ok((await readFile(path.join(dir, r.key))).equals(body));
    assert.ok((await readReceipt(r.key, dir))!.equals(body));
    const BS = String.fromCharCode(92);
    for (const evil of ['../x.png', `..${BS}x.png`, 'a/b.png', `${r.key}/../${r.key}`, 'x.png', '']) assert.equal(await readReceipt(evil, dir), null, evil);
    const r2 = await storeReceipt(body, dir);
    assert.notEqual(r2.key, r.key, 'a name is never reused');
    assert.equal(r2.sha256, r.sha256);
    await discardReceipt(r.key, dir);
    assert.equal(await readReceipt(r.key, dir), null);
    await discardReceipt('../../etc/passwd', dir); // ignored, never deletes outside the key shape
    await assert.rejects(storeReceipt(Buffer.alloc(5000), dir), /CHEK_RASMI_NOTOGRI/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
