import { db } from '../../lib/db.js';
import { loadFeeConfig } from '../pricing/config.js';
import { publicPricing } from '../pricing/fee.js';
import { MAX_QUERY_WORDS, rankIds, scoreVocabulary, Vocabulary, words } from './search-text.js';
import { restaurantCards } from './views.js';

/**
 * Customer search: restaurants by name, dishes by name (also by the restaurant's or the category's name).
 *
 * The searchable text of the whole catalogue lives in memory (a few hundred bytes per dish) and is rebuilt from the database at most once every
 * INDEX_TTL_MS, in the background: a request never waits for a rebuild once the index exists, and typing in the app costs no database reads except
 * one small lookup of the restaurants that appear in the answer (their open/closed state is always read fresh). Words are numbered once per index, so a query
 * compares each distinct word of the catalogue once and then ranks documents by table lookups; 20 000 dishes take a few milliseconds.
 */
const INDEX_TTL_MS = 45_000;
export const DISH_LIMIT = 30;
export const RESTAURANT_LIMIT = 6;

/** Matched text is held as word numbers (see Vocabulary); the other fields are what the app shows. */
interface Text { name: number[]; extra: number[] }
interface DishDoc {
  id: string; label: string; priceSom: number; restaurantId: string; categoryId: string | null; categoryName: string | null;
  isAvailable: boolean; imageUrl: string | null; text: Text;
}
interface RestaurantDoc { id: string; label: string; text: Text }
interface Index {
  builtAt: number; restaurants: RestaurantDoc[]; dishes: DishDoc[];
  vocab: Vocabulary;
  /** Scores of recent query words against this index's vocabulary; it goes away with the index. */
  scoreCache: Map<string, Float32Array>;
}

let index: Index | null = null;
let building: Promise<Index> | null = null;

async function build(): Promise<Index> {
  const [restaurants, products] = await Promise.all([
    db.restaurant.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.product.findMany({
      where: { archivedAt: null, isPackaging: false, restaurant: { isActive: true } },
      select: {
        id: true, name: true, priceSom: true, isAvailable: true, categoryId: true, imageUrl: true, restaurantId: true,
        category: { select: { name: true } }, image: { select: { version: true } }, restaurant: { select: { name: true } },
      },
    }),
  ]);
  const vocab = new Vocabulary();
  const text = (name: string, extra: string[]): Text => ({ name: vocab.idsOf(words(name)), extra: vocab.idsOf(extra.flatMap(e => words(e))) });
  return {
    builtAt: Date.now(),
    vocab,
    scoreCache: new Map(),
    restaurants: restaurants.map(r => ({ id: r.id, label: r.name, text: text(r.name, []) })),
    dishes: products.map(p => ({
      id: p.id, label: p.name, priceSom: p.priceSom, restaurantId: p.restaurantId, categoryId: p.categoryId, categoryName: p.category?.name ?? null,
      isAvailable: p.isAvailable,
      imageUrl: p.image ? `/api/v1/miniapp/products/${p.id}/image?v=${p.image.version}` : p.imageUrl,
      text: text(p.name, p.category ? [p.restaurant.name, p.category.name] : [p.restaurant.name]),
    })),
  };
}

/** The index: built on the first use, then served from memory while one background rebuild per TTL keeps it fresh. A failed rebuild keeps the old one. */
async function current(): Promise<Index> {
  const stale = !index || Date.now() - index.builtAt > INDEX_TTL_MS;
  if (stale && !building) {
    building = build()
      .then(i => { index = i; return i; })
      .finally(() => { building = null; });
    building.catch(() => { /* kept: the previous index serves until the next try */ });
  }
  if (index) return index;
  return building!;
}

/** For tests and for changes that must show at once. */
export function invalidateSearchIndex(): void { index = null; }

export async function searchCatalog(rawQuery: string, now = new Date()) {
  const query = words(rawQuery, MAX_QUERY_WORDS);
  if (query.length === 0) return { restaurants: [], dishes: [], pricing: null };
  const idx = await current();
  // Each distinct word of the catalogue is compared with the query once (the typo check is the costly part); documents then only look scores up.
  const scores = scoreVocabulary(query, idx.vocab.list, idx.scoreCache);

  const restaurantHits: Array<{ doc: RestaurantDoc; score: number }> = [];
  for (const doc of idx.restaurants) { const score = rankIds(scores, doc.text.name, doc.text.extra); if (score !== null) restaurantHits.push({ doc, score }); }
  restaurantHits.sort((a, b) => b.score - a.score || a.doc.label.localeCompare(b.doc.label));

  // Keep only the best DISH_LIMIT while scanning, so a one-letter query over a huge catalogue stays cheap.
  const dishHits: Array<{ doc: DishDoc; score: number }> = [];
  let floor = -Infinity;
  for (const doc of idx.dishes) {
    const score = rankIds(scores, doc.text.name, doc.text.extra);
    if (score === null) continue;
    const adjusted = doc.isAvailable ? score : score - 30; // a dish that cannot be ordered now comes after the ones that can
    if (dishHits.length >= DISH_LIMIT && adjusted <= floor) continue;
    dishHits.push({ doc, score: adjusted });
    if (dishHits.length > DISH_LIMIT * 2) { dishHits.sort((a, b) => b.score - a.score); dishHits.length = DISH_LIMIT; floor = dishHits[DISH_LIMIT - 1]!.score; }
  }
  dishHits.sort((a, b) => b.score - a.score || a.doc.label.localeCompare(b.doc.label));
  const dishes = dishHits.slice(0, DISH_LIMIT);
  const matched = restaurantHits.slice(0, RESTAURANT_LIMIT);

  // One small, fresh read for every restaurant the answer mentions (open / paused state, photo, rating).
  const ids = [...new Set([...matched.map(h => h.doc.id), ...dishes.map(h => h.doc.restaurantId)])];
  const cards = ids.length ? new Map((await restaurantCards(ids, now)).map(c => [c.id, c])) : new Map();
  return {
    restaurants: matched.map(h => cards.get(h.doc.id)).filter((c): c is NonNullable<typeof c> => c !== undefined),
    dishes: dishes.flatMap(({ doc }) => {
      const r = cards.get(doc.restaurantId);
      if (!r) return []; // the restaurant was switched off after the index was built
      return [{
        id: doc.id, name: doc.label, priceSom: doc.priceSom, imageUrl: doc.imageUrl, isAvailable: doc.isAvailable,
        categoryId: doc.categoryId, categoryName: doc.categoryName,
        restaurantId: r.id, restaurantName: r.name, isOpen: r.isOpen, closedReason: r.closedReason,
      }];
    }),
    // Dish prices already contain the platform's fee; the app computes what it shows from this, exactly as on the menu.
    pricing: dishes.length ? publicPricing(await loadFeeConfig()) : null,
  };
}
