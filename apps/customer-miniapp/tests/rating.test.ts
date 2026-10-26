import { describe, expect, it } from 'vitest';
import { initials, nameHue, needsReasons, ratingText, RATING_REASONS } from '../src/lib/rating';

describe('rating helpers', () => {
  it('asks for reasons only below 4 stars', () => {
    expect([1, 2, 3].map(needsReasons)).toEqual([true, true, true]);
    expect([4, 5].map(needsReasons)).toEqual([false, false]);
  });
  it('shows the average with the count, nothing while the server sends none', () => {
    expect(ratingText({ avg: 4.7, count: 128 })).toBe('4.7 (128)');
    expect(ratingText({ avg: 5, count: 5 })).toBe('5.0 (5)');
    expect(ratingText(null)).toBeNull();
    expect(ratingText(undefined)).toBeNull();
  });
  it('placeholder initials and colour are stable', () => {
    expect(initials('Do‘stlik Cafe')).toBe('DC');
    expect(initials('  oqtepa  ')).toBe('O');
    expect(initials('')).toBe('?');
    expect(nameHue('Oqtepa')).toBe(nameHue('Oqtepa'));
    expect(nameHue('Oqtepa')).toBeGreaterThanOrEqual(0);
    expect(nameHue('Oqtepa')).toBeLessThan(360);
  });
  it('offers the same reason codes the server accepts', () => {
    expect(RATING_REASONS.map(r => r.code)).toEqual(['COLD', 'TASTELESS', 'WRONG_ITEM', 'PACKAGING', 'LATE_COOKING', 'OTHER']);
  });
});
