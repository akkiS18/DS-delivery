import { describe, expect, it } from 'vitest';
import { MAX_LINES, MAX_QTY } from '../src/lib/cart';
import { planReorder } from '../src/lib/reorder';
import type { Product } from '../src/lib/types';

const dish = (id: string, isAvailable = true): Product => ({ id, name: id, description: null, priceSom: 10_000, isAvailable, categoryId: null, imageUrl: null });

describe('planReorder', () => {
  it('keeps dishes that are still on the menu, with their quantity', () => {
    const plan = planReorder({ products: [dish('a'), dish('b')] }, [{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }]);
    expect(plan.adds.map(x => [x.product.id, x.quantity])).toEqual([['a', 2], ['b', 1]]);
    expect(plan.missing).toBe(0);
  });
  it('counts dishes that are gone, switched off or packaging ids as missing', () => {
    const plan = planReorder({ products: [dish('a'), dish('off', false)] }, [{ productId: 'a', quantity: 1 }, { productId: 'off', quantity: 1 }, { productId: 'gone', quantity: 1 }, { productId: 'box', quantity: 3 }]);
    expect(plan.adds).toHaveLength(1);
    expect(plan.missing).toBe(3);
  });
  it('limits the quantity of a line and the number of lines to what the basket allows', () => {
    const many = Array.from({ length: MAX_LINES + 2 }, (_, i) => dish(`p${i}`));
    const plan = planReorder({ products: many }, [{ productId: 'p0', quantity: 99 }, ...many.slice(1).map(p => ({ productId: p.id, quantity: 1 }))]);
    expect(plan.adds[0]!.quantity).toBe(MAX_QTY);
    expect(plan.adds).toHaveLength(MAX_LINES);
    expect(plan.missing).toBe(2);
  });
  it('treats a nonsense quantity as one', () => {
    expect(planReorder({ products: [dish('a')] }, [{ productId: 'a', quantity: 0 }]).adds[0]!.quantity).toBe(1);
  });
});
