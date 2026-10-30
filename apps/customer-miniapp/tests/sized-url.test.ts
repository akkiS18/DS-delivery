import { describe, expect, it } from 'vitest';
import { sizedUrl } from '../src/lib/platform';

describe('sizedUrl: a smaller copy of the restaurant\'s own uploads', () => {
  it('adds the width to a versioned photo URL of ours', () => {
    expect(sizedUrl('/api/v1/miniapp/products/p1/image?v=3', 320)).toBe('/api/v1/miniapp/products/p1/image?v=3&w=320');
    expect(sizedUrl('/api/v1/miniapp/categories/c1/image?v=1', 640)).toBe('/api/v1/miniapp/categories/c1/image?v=1&w=640');
    expect(sizedUrl('/api/v1/miniapp/restaurants/r1/image', 640)).toBe('/api/v1/miniapp/restaurants/r1/image?w=640');
  });
  it('leaves everything else alone (no width, an external link, another path)', () => {
    expect(sizedUrl('/api/v1/miniapp/products/p1/image?v=3')).toBe('/api/v1/miniapp/products/p1/image?v=3');
    expect(sizedUrl('https://example.com/a.jpg', 320)).toBe('https://example.com/a.jpg');
    expect(sizedUrl('/api/v1/miniapp/orders/o1', 320)).toBe('/api/v1/miniapp/orders/o1');
  });
});
