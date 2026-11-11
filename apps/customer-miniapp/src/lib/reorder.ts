import { MAX_LINES, MAX_QTY } from './cart';
import type { MenuResponse, Product } from './types';

export interface ReorderLine { productId: string; quantity: number }

/**
 * What of a past order can go back into the basket from the restaurant's menu today: dishes that are still on the menu and available, with their
 * earlier quantity (up to the basket limit). `missing` counts the earlier dishes that are gone or switched off, so the customer is told.
 */
export function planReorder(menu: Pick<MenuResponse, 'products'>, lines: readonly ReorderLine[]): { adds: Array<{ product: Product; quantity: number }>; missing: number } {
  const byId = new Map(menu.products.map(p => [p.id, p]));
  const adds: Array<{ product: Product; quantity: number }> = [];
  let missing = 0;
  for (const l of lines) {
    const product = byId.get(l.productId);
    if (!product || !product.isAvailable || adds.length >= MAX_LINES) { missing++; continue; }
    adds.push({ product, quantity: Math.min(MAX_QTY, Math.max(1, Math.trunc(l.quantity))) });
  }
  return { adds, missing };
}
