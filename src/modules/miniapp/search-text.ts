/**
 * Text side of the customer search. Pure functions, no database.
 *
 * Menu names and typed queries go through the same steps so they meet in the middle:
 *   1. normalize: lower case, no diacritics, Cyrillic -> Latin (Uzbek and Russian), apostrophes dropped (o‘, g‘, ma’lumot), only a-z 0-9 and spaces
 *   2. skeleton: a loose spelling per word, so "pizza" = "pitsa" = "пицца", "xot-dog" = "hot dog", "kfc" = "kfs"-like variants meet
 * A query word matches a name word exactly, as a prefix (the customer is still typing), inside it, or with a small typing mistake.
 */

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};
const APOSTROPHES = /[‘’ʻʼʽ`´ʹ′']/g;
const MARKS = /[̀-ͯ]/g;

/** Lower case Latin letters, digits and single spaces. Cyrillic is transliterated; apostrophes vanish (o‘ -> o). */
export function normalize(text: string): string {
  // Cyrillic first: splitting accents off (NFKD) would turn й into и and ё into е, and ў into у.
  let latin = '';
  for (const ch of text.toLowerCase()) latin += CYRILLIC[ch] ?? ch;
  return latin.normalize('NFKD').toLowerCase().replace(MARKS, '').replace(APOSTROPHES, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A loose spelling of one normalized word: letters that sound alike are one letter, doubled letters are single. */
export function skeleton(word: string): string {
  return word
    .replace(/ch/g, '#').replace(/sh/g, '$') // keep these pairs whole while single letters are folded
    .replace(/ck/g, 'k').replace(/ph/g, 'f').replace(/ts/g, 's').replace(/tz/g, 's')
    .replace(/x/g, 'h').replace(/q/g, 'k').replace(/c/g, 'k').replace(/w/g, 'v').replace(/z/g, 's')
    .replace(/#/g, 'ch').replace(/\$/g, 'sh')
    .replace(/(.)\1+/g, '$1');
}

export const MAX_QUERY_WORDS = 5;

/** The words of a text in skeleton form. */
export function words(text: string, max = Infinity): string[] {
  const parts = normalize(text).split(' ').filter(Boolean).map(skeleton).filter(Boolean);
  return parts.length > max ? parts.slice(0, max) : parts;
}

/**
 * Edit distance where swapping two neighbouring letters ("lavsah") costs one, the commonest slip on a phone keyboard.
 * Gives up (returning limit + 1) as soon as the distance must exceed `limit`.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let older: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevMin = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, older[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // A swap reaches back two rows, so the distance is only certainly over the limit when two rows in a row are.
    if (rowMin > limit && prevMin > limit) return limit + 1;
    prevMin = rowMin;
    older = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** How many typing mistakes a query word of this length may have. Short words must be exact: "osh" must not find "ash". */
const allowedMistakes = (len: number): number => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

/** 0 = no match; otherwise higher is better (100 exact ... 30 a typo). */
export function wordScore(query: string, name: string): number {
  if (query === name) return 100;
  if (name.startsWith(query)) return 85 - Math.min(10, name.length - query.length);
  if (query.length >= 3 && name.includes(query)) return 55;
  const k = allowedMistakes(query.length);
  if (k === 0) return 0;
  const whole = editDistance(query, name, k);
  if (whole <= k) return 45 - 10 * whole;
  // the customer may still be typing a longer word with one slip: compare with the word's beginning
  if (name.length > query.length) {
    const head = editDistance(query, name.slice(0, query.length), k);
    if (head <= k) return 40 - 10 * head;
  }
  return 0;
}

/**
 * Every distinct word of the catalogue once. Documents refer to words by number, so a query scores each DISTINCT word once (a few thousand)
 * instead of every word of every dish (tens of thousands): the typo comparison is the only expensive step, and it no longer repeats.
 */
export class Vocabulary {
  readonly list: string[] = [];
  private readonly ids = new Map<string, number>();
  id(word: string): number {
    let i = this.ids.get(word);
    if (i === undefined) { i = this.list.length; this.list.push(word); this.ids.set(word, i); }
    return i;
  }
  idsOf(ws: string[]): number[] { return ws.map(w => this.id(w)); }
}

/** For each query word: its score against every vocabulary word (0 = no match). `first` marks the vocabulary words that begin with the first query word. */
export interface QueryScores { perWord: Float32Array[]; first: Uint8Array }

/** `cache` (token -> scores over this vocabulary) is owned by the caller and must be dropped when the vocabulary changes. */
export function scoreVocabulary(query: string[], vocab: readonly string[], cache?: Map<string, Float32Array>): QueryScores {
  const perWord = query.map(q => {
    const known = cache?.get(q);
    if (known && known.length === vocab.length) return known;
    const scores = new Float32Array(vocab.length);
    for (let i = 0; i < vocab.length; i++) scores[i] = wordScore(q, vocab[i]!);
    if (cache) { if (cache.size >= 400) cache.clear(); cache.set(q, scores); }
    return scores;
  });
  const first = new Uint8Array(vocab.length);
  const head = query[0];
  if (head) for (let i = 0; i < vocab.length; i++) first[i] = vocab[i]!.startsWith(head) ? 1 : 0;
  return { perWord, first };
}

/** Same ranking as [rank], over word numbers and precomputed scores. */
export function rankIds(scores: QueryScores, name: ArrayLike<number>, extra: ArrayLike<number>): number | null {
  const n = scores.perWord.length;
  if (n === 0) return null;
  let total = 0;
  let inName = 0;
  for (let k = 0; k < n; k++) {
    const s = scores.perWord[k]!;
    let best = 0;
    for (let i = 0; i < name.length; i++) { const v = s[name[i]!]!; if (v > best) best = v; }
    let fromName = best > 0;
    if (best < 100) {
      for (let i = 0; i < extra.length; i++) { const v = s[extra[i]!]! * EXTRA_WEIGHT; if (v > best) { best = v; fromName = false; } }
    }
    if (best <= 0) return null;
    if (fromName) inName += 1;
    total += best;
  }
  let score = total / n;
  if (inName === n) score += 10;
  if (name.length > 0 && scores.first[name[0]!]) score += 15;
  return score - 0.5 * name.length;
}

export interface Searchable {
  /** Words of the name itself. */
  name: string[];
  /** Words that also lead to it but count for less: the restaurant a dish belongs to, its category. */
  extra: string[];
}

const EXTRA_WEIGHT = 0.4;

/** null = does not match (every query word must match something); otherwise the rank (higher is better). */
export function rank(query: string[], doc: Searchable): number | null {
  if (query.length === 0) return null;
  let total = 0;
  let inName = 0;
  for (const q of query) {
    let best = 0;
    let fromName = false;
    for (const w of doc.name) { const s = wordScore(q, w); if (s > best) { best = s; fromName = true; } }
    if (best < 100) for (const w of doc.extra) { const s = wordScore(q, w) * EXTRA_WEIGHT; if (s > best) { best = s; fromName = false; } }
    if (best <= 0) return null;
    if (fromName) inName += 1;
    total += best;
  }
  let score = total / query.length;
  if (inName === query.length) score += 10;
  if (doc.name[0] && query[0] && doc.name[0].startsWith(query[0])) score += 15;
  return score - 0.5 * doc.name.length;
}
