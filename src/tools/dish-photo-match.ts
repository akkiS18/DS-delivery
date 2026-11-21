/** Pure helpers of set-dish-photos.ts: which dishes a picture file name belongs to. */

/** "G‘ilak sho‘rva (1 porsiya)" -> "gilak-shorva-1-porsiya". */
export function slugifyName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’'ʻʼ`´]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const withoutBrackets = (s: string): string => s.replace(/\([^)]*\)/g, ' ').trim();

/** Exact whole-name match first ("osh-1-kg" -> "Osh (1 kg)"); if none, the name without its bracket part (every portion size). */
export function matchDishes<T extends { name: string }>(fileStem: string, dishes: T[]): T[] {
  const key = slugifyName(fileStem);
  if (!key) return [];
  const exact = dishes.filter(d => slugifyName(d.name) === key);
  return exact.length ? exact : dishes.filter(d => slugifyName(withoutBrackets(d.name)) === key);
}
