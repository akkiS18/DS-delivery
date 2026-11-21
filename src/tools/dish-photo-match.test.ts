import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchDishes, slugifyName } from './dish-photo-match.js';

const muslima = ['Sho‘rva (1 porsiya)', 'Sho‘rva (0,7 porsiya)', 'G‘ilak sho‘rva (1 porsiya)', 'G‘ilak sho‘rva (0,7 porsiya)', 'Osh (1 porsiya)', 'Osh (0,7 porsiya)',
  'Debzira zakaz chaqar osh (1 kg)', 'Lag‘mon uyg‘ur (1 porsiya)', 'Qovurma lag‘mon', 'Achik-chuchuk', 'Qo‘y go‘shti JIZ (1 kg)'].map(name => ({ name }));
const names = (stem: string): string[] => matchDishes(stem, muslima).map(d => d.name);

test('slugifyName drops every apostrophe form and brackets become dashes', () => {
  assert.equal(slugifyName('G‘ilak sho‘rva (1 porsiya)'), 'gilak-shorva-1-porsiya');
  assert.equal(slugifyName("G'ilak sho'rva"), 'gilak-shorva');
  assert.equal(slugifyName('Gʻilak shoʻrva'), 'gilak-shorva');
  assert.equal(slugifyName('Sho‘rva (0,7 porsiya)'), 'shorva-0-7-porsiya');
});

test('a plain name sets every portion size of that dish, and only it', () => {
  assert.deepEqual(names('gilak-shorva'), ['G‘ilak sho‘rva (1 porsiya)', 'G‘ilak sho‘rva (0,7 porsiya)']);
  assert.deepEqual(names('shorva'), ['Sho‘rva (1 porsiya)', 'Sho‘rva (0,7 porsiya)']);
  assert.deepEqual(names('osh'), ['Osh (1 porsiya)', 'Osh (0,7 porsiya)']);
});

test('the whole name picks one portion; other forms of writing match too', () => {
  assert.deepEqual(names('osh-0-7-porsiya'), ['Osh (0,7 porsiya)']);
  assert.deepEqual(names('Debzira zakaz chaqar osh'), ['Debzira zakaz chaqar osh (1 kg)']);
  assert.deepEqual(names('qoy-goshti-jiz'), ['Qo‘y go‘shti JIZ (1 kg)']);
  assert.deepEqual(names('achik-chuchuk'), ['Achik-chuchuk']);
  assert.deepEqual(names('lagmon'), []);
  assert.deepEqual(names('---'), []);
});
