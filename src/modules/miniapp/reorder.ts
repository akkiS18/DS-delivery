/** What "Yana buyurtma berish" needs from a past order: the dishes (and how many of each) the customer can put back in the basket. */
export interface ReorderLine { productId: string; quantity: number }

/**
 * One entry per dish. A 1+1 free unit is stored as a second line of the same dish, so its quantity is added (the customer ordered that many
 * units; the basket gives the free one again). Lines without a dish (deleted since) and non-positive quantities are skipped. Packaging lines
 * carry the packaging product's id: the app only matches ids against the restaurant's menu dishes, where packaging never appears, so they drop out.
 */
export function reorderLines(items: ReadonlyArray<{ productId: string | null; quantity: number }>): ReorderLine[] {
  const sums = new Map<string, number>();
  for (const i of items) {
    if (!i.productId || !Number.isFinite(i.quantity) || i.quantity <= 0) continue;
    sums.set(i.productId, (sums.get(i.productId) ?? 0) + i.quantity);
  }
  return [...sums].map(([productId, quantity]) => ({ productId, quantity }));
}
