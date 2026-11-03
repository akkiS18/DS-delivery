import assert from 'node:assert/strict';
import test from 'node:test';
import { editDistance, normalize, rank, rankIds, scoreVocabulary, skeleton, Vocabulary, wordScore, words, type Searchable } from './search-text.js';

const doc = (name: string, extra = ''): Searchable => ({ name: words(name), extra: words(extra) });
const hit = (q: string, d: Searchable): number | null => rank(words(q), d);

test('normalize: case, apostrophes, diacritics and Cyrillic meet in plain Latin', () => {
  assert.equal(normalize('O‘SH'), 'osh');
  assert.equal(normalize('o\'sh'), 'osh');
  assert.equal(normalize('Ma’lumot'), 'malumot');
  assert.equal(normalize('Лаваш'), 'lavash');
  assert.equal(normalize('  Ош   хонаси '), 'osh xonasi');
  assert.equal(normalize('Ўзбек қази'), 'ozbek qazi');
  assert.equal(normalize('Café №1!'), 'cafe no1');
});

test('skeleton: letters that sound alike are one letter', () => {
  assert.equal(skeleton('pizza'), skeleton('pitsa'));
  assert.equal(skeleton(normalize('пицца')), skeleton('pizza'));
  assert.equal(skeleton('xaggi'), skeleton('haggi'));
  assert.equal(skeleton('kebab'), skeleton('qebab'));
  assert.equal(skeleton('chicken'), 'chiken');
  assert.equal(skeleton('shashlik'), 'shashlik', 'ch and sh stay whole');
});

test('editDistance stops at the limit', () => {
  assert.equal(editDistance('lavash', 'lavash', 2), 0);
  assert.equal(editDistance('lavash', 'lavsh', 2), 1);
  assert.equal(editDistance('lavash', 'lavsah', 2), 1, 'two neighbouring letters swapped');
  assert.ok(editDistance('lavash', 'lavxyz', 2) > 2, 'three letters wrong');
  assert.ok(editDistance('lavash', 'donar', 2) > 2);
  assert.ok(editDistance('a', 'abcdef', 2) > 2);
});

test('wordScore: exact > prefix > inside > typo; short words must be exact', () => {
  const s = (q: string, n: string) => wordScore(skeleton(q), skeleton(n));
  assert.equal(s('lavash', 'lavash'), 100);
  assert.ok(s('lav', 'lavash') >= 75 && s('lav', 'lavash') < 100);
  assert.ok(s('vash', 'lavash') > 0 && s('vash', 'lavash') < s('lav', 'lavash'));
  assert.ok(s('lavsh', 'lavash') > 0, 'one slip');
  assert.ok(s('lavsah', 'lavash') > 0, 'swapped letters');
  assert.equal(s('osh', 'ash'), 0, 'three letters: no guessing');
  assert.equal(s('osh', 'osh'), 100);
  assert.ok(s('burgr', 'burger') > 0);
  assert.equal(s('pizza', 'burger'), 0);
});

test('rank: every word must match; the name beats the restaurant; prefixes find half-typed words', () => {
  const lavash = doc('Tandir lavash', 'Sifat Food Lavash');
  assert.ok(hit('lavash', lavash)! > 0);
  assert.ok(hit('lav', lavash)! > 0, 'still typing');
  assert.ok(hit('tandir lav', lavash)! > 0, 'two words');
  assert.equal(hit('tandir pizza', lavash), null, 'one word has no match');
  assert.equal(hit('', lavash), null);

  // a dish reached through its restaurant's name ranks below one with the word in its own name
  const sifatDish = doc('Burger', 'Sifat Food');
  const sifatNamed = doc('Sifat burger', '');
  assert.ok(hit('sifat', sifatDish)! > 0);
  assert.ok(hit('sifat', sifatNamed)! > hit('sifat', sifatDish)!);
});

test('rank: Cyrillic and Latin spellings find each other, and typos are forgiven', () => {
  assert.ok(hit('лаваш', doc('Lavash'))! > 0);
  assert.ok(hit('lavash', doc('Лаваш'))! > 0);
  assert.ok(hit('osh', doc('O‘sh'))! > 0);
  assert.ok(hit('пицца', doc('PIZZA ASARTI'))! > 0);
  assert.ok(hit('pitsa', doc('Pizza'))! > 0);
  assert.ok(hit('hamburgr', doc('Hamburger'))! > 0, 'a missing letter');
  assert.ok(hit('donar', doc('Donar'))! > hit('don', doc('Donar'))!, 'exact beats a prefix');
});

test('rank: an exact short name outranks a longer one with the word inside', () => {
  const exact = hit('osh', doc('Osh'))!;
  const longer = hit('osh', doc('Osh xonasi menyusi'))!;
  assert.ok(exact > longer);
});

test('rankIds over a shared vocabulary ranks exactly like rank', () => {
  const docs = [doc('Tandir lavash', 'Sifat Food'), doc('Lavash', 'Sifat Food Lavash'), doc('Burger', 'Sifat'), doc('Osh', ''), doc('Ош хонаси', 'Lavash uyi')];
  const vocab = new Vocabulary();
  const ids = docs.map(d => ({ name: vocab.idsOf(d.name), extra: vocab.idsOf(d.extra) }));
  for (const q of ['lavash', 'lavsh', 'tandir lav', 'sifat', 'osh', 'ош', 'xonasi', 'pizza', 'lav sifat']) {
    const query = words(q);
    const scores = scoreVocabulary(query, vocab.list, new Map());
    docs.forEach((d, i) => {
      const a = rank(query, d);
      const b = rankIds(scores, ids[i]!.name, ids[i]!.extra);
      assert.equal(a === null, b === null, `${q} / doc ${i}`);
      if (a !== null) assert.ok(Math.abs(a - b!) < 0.01, `${q} / doc ${i}: ${a} vs ${b}`);
    });
  }
});
