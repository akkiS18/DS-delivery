import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { LOGO_MAX_WIDTH, pickPicture, wantsLogo } from './image.js';
import { restaurantImageUrl } from '../miniapp/views.js';
import { parseWidth } from '../images/variants.js';
import { LOGO_WIDE_RATIO, edgeColour, logoOnWide } from '../images/logo-wide.js';

test('small square frames (?w=160 / 320) want the logo; no width or a wide frame does not', () => {
  assert.equal(wantsLogo(parseWidth('160')), true);
  assert.equal(wantsLogo(parseWidth('100')), true); // snaps up to 160
  assert.equal(wantsLogo(parseWidth(String(LOGO_MAX_WIDTH))), true);
  assert.equal(wantsLogo(parseWidth('640')), false);
  assert.equal(wantsLogo(parseWidth('400')), false); // snaps up to 640
  assert.equal(wantsLogo(parseWidth(undefined)), false);
  assert.equal(wantsLogo(parseWidth('abc')), false);
});

test('which picture each frame gets', () => {
  // no logo: always the main picture, exactly as before
  for (const w of [null, 160, 640]) for (const slot of [null, 'cover']) assert.equal(pickPicture(w, slot, false), 'image');
  // with a logo
  assert.equal(pickPicture(160, null, true), 'logo'); // search / closed rows, order screen
  assert.equal(pickPicture(640, null, true), 'logoWide'); // home card
  assert.equal(pickPicture(640, 'cover', true), 'image'); // menu header background
  assert.equal(pickPicture(160, 'cover', true), 'image');
  assert.equal(pickPicture(null, null, true), 'image'); // staff apps asking for the stored photo
  assert.equal(pickPicture(640, 'other', true), 'logoWide'); // an unknown slot is ignored
});

test('the picture URL carries the logo version, so a new logo is fetched again despite the hard cache', () => {
  assert.equal(restaurantImageUrl('r1', undefined, 3), null);
  assert.equal(restaurantImageUrl('r1', 2), '/api/v1/miniapp/restaurants/r1/image?v=2');
  assert.equal(restaurantImageUrl('r1', 2, 1), '/api/v1/miniapp/restaurants/r1/image?v=2.1');
});

test('edgeColour takes the median of the outer columns only', () => {
  // 4x1: black, red, red, black -> edges are black
  const raw = Buffer.from([0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0]);
  assert.deepEqual(edgeColour(raw, 4, 1, 1), { r: 0, g: 0, b: 0 });
});

test('logoOnWide puts a square logo on a 3:1 canvas of its own edge colour', async () => {
  // a square logo: dark blue background with a white disc in the middle
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#10204a"/><circle cx="200" cy="200" r="150" fill="#fff"/></svg>`;
  const data = await sharp(Buffer.from(svg)).png().toBuffer();
  const pic = await logoOnWide({ data, sha256: 'test-logo' });
  assert.ok(pic);
  const meta = await sharp(pic.data).metadata();
  assert.equal(meta.width! / meta.height!, LOGO_WIDE_RATIO);
  const { data: px, info } = await sharp(pic.data).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => { const i = (y * info.width + x) * 3; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
  const [r, g, b] = at(5, Math.floor(info.height / 2)); // far left = the logo's background colour
  assert.ok(Math.abs(r - 0x10) < 12 && Math.abs(g - 0x20) < 12 && Math.abs(b - 0x4a) < 12, `left edge ${r},${g},${b}`);
  const c = at(Math.floor(info.width / 2), Math.floor(info.height / 2)); // centre = the white disc
  assert.ok(c.every(v => v > 235), `centre ${c}`);
  assert.equal(pic.sha256, 'test-logo-wide3');
  assert.equal(await logoOnWide({ data, sha256: 'test-logo' }), pic); // cached
});
