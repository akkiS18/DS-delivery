import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import sharp from 'sharp';
import { sendImage } from './serve.js';
import { IMAGE_WIDTHS, MAX_INPUT_PIXELS, _resetVariantCache, imageVariant, parseWidth, variantEtag } from './variants.js';

beforeEach(() => _resetVariantCache());

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A noisy photo-like JPEG (noise does not compress, so the original is clearly big). */
async function photo(width: number, height: number, opts: { rotate?: boolean } = {}): Promise<Buffer> {
  const raw = randomBytes(width * height * 3);
  let img = sharp(raw, { raw: { width, height, channels: 3 } });
  if (opts.rotate) img = img.withMetadata({ orientation: 6 });
  return img.jpeg({ quality: 92 }).toBuffer();
}

test('parseWidth snaps up to an allowed width and ignores anything unreadable', () => {
  assert.equal(parseWidth('300'), 320);
  assert.equal(parseWidth('160'), 160);
  assert.equal(parseWidth('161'), 320);
  assert.equal(parseWidth('5000'), IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]);
  for (const bad of [undefined, '', 'abc', '-5', '0', '10.5', '1e3', '12345', ['320'], 320]) assert.equal(parseWidth(bad), null, String(bad));
});

test('a big photo becomes a much smaller JPEG of the asked width; the same request is served from memory', async () => {
  const original = await photo(1600, 1200);
  const img = { data: original, sha256: sha(original) };
  const v = await imageVariant(img, 320);
  assert.ok(v);
  assert.equal(v.mime, 'image/jpeg');
  assert.ok(v.data.length < original.length / 4, `${v.data.length} vs ${original.length}`);
  const meta = await sharp(v.data).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 320, 240]);
  assert.equal(v.etag, variantEtag(img.sha256, 320));
  assert.strictEqual(await imageVariant(img, 320), v, 'cached: the very same object');
  const [a, b] = await Promise.all([imageVariant(img, 640), imageVariant(img, 640)]);
  assert.strictEqual(a, b, 'two simultaneous requests share one conversion');
});

test('WebP is a separate, smaller copy with its own ETag; only a caller that accepts image/webp gets it', async () => {
  const original = await photo(1200, 900);
  const img = { mime: 'image/jpeg', data: original, sha256: sha(original) };
  const jpeg = await imageVariant(img, 320);
  const webp = await imageVariant(img, 320, 'webp');
  assert.ok(jpeg && webp);
  assert.equal(webp.mime, 'image/webp');
  assert.equal((await sharp(webp.data).metadata()).format, 'webp');
  assert.notEqual(webp.etag, jpeg.etag);
  assert.equal(webp.etag, variantEtag(img.sha256, 320, 'webp'));
  assert.equal(variantEtag(img.sha256, 320), `"${img.sha256}-w320"`, 'the JPEG ETag is unchanged');
  const app = Fastify();
  app.get('/i', async (request, reply) => sendImage(request, reply, img));
  try {
    const w = await app.inject({ url: '/i?w=300', headers: { accept: 'image/avif,image/webp,image/apng,*/*;q=0.8' } });
    assert.equal(w.headers['content-type'], 'image/webp');
    assert.equal(w.headers.etag, webp.etag);
    assert.equal(w.headers.vary, 'Accept');
    assert.equal((await app.inject({ url: '/i?w=300', headers: { accept: 'image/webp', 'if-none-match': webp.etag } })).statusCode, 304);
    const j = await app.inject({ url: '/i?w=300', headers: { accept: 'image/png,*/*' } });
    assert.equal(j.headers['content-type'], 'image/jpeg');
    assert.equal(j.headers.etag, jpeg.etag);
    assert.equal((await app.inject({ url: '/i?w=300', headers: { accept: 'image/png,*/*', 'if-none-match': webp.etag } })).statusCode, 200, 'a WebP ETag never validates the JPEG answer');
  } finally { await app.close(); }
});

test('never enlarged and never sent when not smaller: a small image gets null (the caller sends the original)', async () => {
  const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#336699' } }).jpeg({ quality: 40 }).toBuffer();
  assert.equal(await imageVariant({ data: small, sha256: sha(small) }, 320), null);
});

test('EXIF rotation is applied and transparency becomes white', async () => {
  const rotated = await photo(800, 400, { rotate: true });
  const v = await imageVariant({ data: rotated, sha256: sha(rotated) }, 320);
  assert.ok(v);
  const m = await sharp(v.data).metadata();
  assert.ok(m.height! > m.width!, 'orientation 6 turns a landscape file upright');
  const png = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png({ compressionLevel: 0 }).toBuffer();
  const p = await imageVariant({ data: png, sha256: sha(png) }, 320);
  assert.ok(p);
  const px = await sharp(p.data).raw().toBuffer();
  assert.ok(px[0]! > 245 && px[1]! > 245 && px[2]! > 245, 'transparent pixel is white, not black');
});

test('a corrupt or oversized image is refused quietly (null) and not retried', async () => {
  const junk = randomBytes(5000);
  assert.equal(await imageVariant({ data: junk, sha256: sha(junk) }, 320), null);
  const huge = await sharp({ create: { width: 8000, height: Math.ceil(MAX_INPUT_PIXELS / 8000) + 10, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.equal(await imageVariant({ data: huge, sha256: sha(huge) }, 320), null, 'over the pixel limit');
});

test('the route helper: no ?w = the original untouched; ?w = the copy with its own ETag and a 304 on repeat; bad ?w = the original', async () => {
  const original = await photo(1200, 900);
  const img = { mime: 'image/jpeg', data: original, sha256: sha(original) };
  const app = Fastify();
  app.get('/i', async (request, reply) => sendImage(request, reply, img));
  try {
    const plain = await app.inject({ url: '/i' });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.rawPayload.length, original.length);
    assert.equal(plain.headers.etag, `"${img.sha256}"`);
    assert.equal((await app.inject({ url: '/i', headers: { 'if-none-match': `"${img.sha256}"` } })).statusCode, 304);

    const small = await app.inject({ url: '/i?w=300&v=3' });
    assert.equal(small.statusCode, 200);
    assert.equal(small.headers['content-type'], 'image/jpeg');
    assert.equal(small.headers.etag, variantEtag(img.sha256, 320));
    assert.match(String(small.headers['cache-control']), /immutable/);
    assert.ok(small.rawPayload.length < original.length / 3);
    assert.equal((await app.inject({ url: '/i?w=300', headers: { 'if-none-match': variantEtag(img.sha256, 320) } })).statusCode, 304);

    for (const bad of ['?w=abc', '?w=-1', '?w=99999', '?w=']) {
      const r = await app.inject({ url: `/i${bad}` });
      assert.equal(r.statusCode, 200, bad);
      assert.ok(r.rawPayload.length > 0, bad);
    }
    assert.equal((await app.inject({ url: '/i?w=abc' })).rawPayload.length, original.length, 'an unreadable width falls back to the original');
  } finally { await app.close(); }
});
