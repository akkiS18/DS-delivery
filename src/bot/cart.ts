export type Cart = Record<string, number>;

export const MAX_CART_PRODUCTS = 20;
export const MAX_PRODUCT_QUANTITY = 30;

export function changeQuantity(cart: Cart, productId: string, delta: number): Cart {
  if (!productId || !Number.isInteger(delta) || ![-1, 1].includes(delta)) {
    throw new Error('INVALID_CART_CHANGE');
  }
  const previous = cart[productId] ?? 0;
  if (!Number.isInteger(previous) || previous < 0 || previous > MAX_PRODUCT_QUANTITY) {
    throw new Error('INVALID_CART_STATE');
  }
  if (delta > 0 && previous === 0 && Object.keys(cart).length >= MAX_CART_PRODUCTS) {
    throw new Error('CART_FULL');
  }
  const nextQuantity = previous + delta;
  if (nextQuantity > MAX_PRODUCT_QUANTITY) throw new Error('MAX_QUANTITY');
  const next: Cart = { ...cart };
  if (nextQuantity <= 0) delete next[productId];
  else next[productId] = nextQuantity;
  return next;
}

export function removeItem(cart: Cart, productId: string): Cart {
  const next = { ...cart };
  delete next[productId];
  return next;
}

export function countItems(cart: Cart): number {
  return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

export function cartTotal(cart: Cart, prices: ReadonlyMap<string, number>): number {
  return Object.entries(cart).reduce((sum, [id, quantity]) => {
    const price = prices.get(id);
    if (price === undefined || !Number.isSafeInteger(price) || price < 0) return sum;
    return sum + price * quantity;
  }, 0);
}
