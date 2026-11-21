import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_MAX_WIDTH, wantsLogo } from './image.js';
import { restaurantImageUrl } from '../miniapp/views.js';
import { parseWidth } from '../images/variants.js';

test('small square frames (?w=160 / 320) get the logo; no width or a wide frame gets the main picture', () => {
  assert.equal(wantsLogo(parseWidth('160')), true);
  assert.equal(wantsLogo(parseWidth('100')), true); // snaps up to 160
  assert.equal(wantsLogo(parseWidth(String(LOGO_MAX_WIDTH))), true);
  assert.equal(wantsLogo(parseWidth('640')), false); // home card / menu header
  assert.equal(wantsLogo(parseWidth('400')), false); // snaps up to 640
  assert.equal(wantsLogo(parseWidth(undefined)), false);
  assert.equal(wantsLogo(parseWidth('abc')), false);
});

test('the picture URL carries the logo version, so a new logo is fetched again despite the hard cache', () => {
  assert.equal(restaurantImageUrl('r1', undefined, 3), null);
  assert.equal(restaurantImageUrl('r1', 2), '/api/v1/miniapp/restaurants/r1/image?v=2');
  assert.equal(restaurantImageUrl('r1', 2, 1), '/api/v1/miniapp/restaurants/r1/image?v=2.1');
});
