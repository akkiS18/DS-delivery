import { describe, expect, it } from 'vitest';
import { insideBounds, MAP_BOUNDS, roundPoint, TOWN_CENTER } from '../src/lib/mapConfig';
import { BufferSource, loadWholeFile } from '../src/lib/mapSource';

describe('map bounds', () => {
  it('the town centre is inside the map area, places far away are not', () => {
    expect(insideBounds(TOWN_CENTER)).toBe(true);
    expect(insideBounds({ lat: 41.31, lng: 69.24 })).toBe(false);      // Tashkent
    expect(insideBounds({ lat: NaN, lng: 65.6 })).toBe(false);
  });
  it('the edges count as inside', () => {
    expect(insideBounds({ lng: MAP_BOUNDS[0], lat: MAP_BOUNDS[1] })).toBe(true);
    expect(insideBounds({ lng: MAP_BOUNDS[2], lat: MAP_BOUNDS[3] })).toBe(true);
  });
  it('rounds to six decimals', () => {
    expect(roundPoint({ lat: 40.03044444444, lng: 65.66724999 })).toEqual({ lat: 40.030444, lng: 65.66725 });
  });
});

describe('BufferSource', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;
  it('returns exactly the asked slice', async () => {
    const s = new BufferSource('k', bytes);
    expect(s.getKey()).toBe('k');
    expect(Array.from(new Uint8Array((await s.getBytes(2, 3)).data))).toEqual([2, 3, 4]);
  });
  it('a read past the end is shortened, not an error', async () => {
    const s = new BufferSource('k', bytes);
    expect(Array.from(new Uint8Array((await s.getBytes(8, 10)).data))).toEqual([8, 9]);
  });
  it('loadWholeFile rejects a failed download', async () => {
    const bad = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(loadWholeFile('x', bad)).rejects.toThrow('MAP_FILE_404');
    const ok = (async () => new Response(new Uint8Array([1, 2]))) as unknown as typeof fetch;
    expect((await loadWholeFile('x', ok)).byteLength).toBe(2);
  });
});
