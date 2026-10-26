import type { Restaurant } from './types';

/** Quick reasons offered for 1-3 stars (the codes are the server's RATING_REASONS). */
export const RATING_REASONS = [
  { code: 'COLD', label: 'Sovuq edi' },
  { code: 'TASTELESS', label: 'Mazasiz' },
  { code: 'WRONG_ITEM', label: 'Noto‘g‘ri taom' },
  { code: 'PACKAGING', label: 'Qadoq' },
  { code: 'LATE_COOKING', label: 'Kech tayyorlandi' },
  { code: 'OTHER', label: 'Boshqa' },
] as const;
export type ReasonCode = (typeof RATING_REASONS)[number]['code'];
export const NOTE_MAX = 200;

/** 1-3 stars ask "what went wrong?"; 4-5 are saved with one tap. */
export const needsReasons = (stars: number): boolean => stars <= 3;

/** "4.7 (128)" or null while the restaurant has fewer than the minimum number of ratings (the server then sends no rating). */
export function ratingText(r: Restaurant['rating'] | undefined): string | null {
  return r ? `${r.avg.toFixed(1)} (${r.count})` : null;
}

/** Initials for the photo placeholder: up to two letters from the first words of the name. */
export function initials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map(w => [...w][0] ?? '').join('');
  return (letters || '?').toUpperCase();
}

/** A stable hue (0-359) from the name so each restaurant's placeholder keeps its own colour. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
