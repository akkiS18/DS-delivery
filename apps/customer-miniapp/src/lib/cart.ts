import type { CartLine, CartState } from './types';

/** Pure cart logic + tolerant persistence. Prices stored here are only for display: the server re-reads every price at checkout. */
export const MAX_QTY = 30;
export const MAX_LINES = 20;
export const STORAGE_KEY = 'ds.cart.v1';

export const emptyCart = (): CartState => ({ restaurantId: null, restaurantName: null, lines: [] });

export type CartAction =
  | { type: 'add'; restaurantId: string; restaurantName: string; product: { id: string; name: string; priceSom: number } }
  | { type: 'inc'; productId: string }
  | { type: 'dec'; productId: string }
  | { type: 'remove'; productId: string }
  | { type: 'reprice'; lines: Array<{ productId: string; unitSom: number }> }
  | { type: 'drop'; productIds: string[] }
  | { type: 'clear' };

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // One restaurant per order: adding from another restaurant starts a fresh cart (the UI asks the customer first).
      const base: CartState = state.restaurantId === action.restaurantId ? state : { restaurantId: action.restaurantId, restaurantName: action.restaurantName, lines: [] };
      const existing = base.lines.find(l => l.productId === action.product.id);
      if (existing) return { ...base, lines: base.lines.map(l => (l.productId === existing.productId ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l)) };
      if (base.lines.length >= MAX_LINES) return base;
      return { ...base, lines: [...base.lines, { productId: action.product.id, name: action.product.name, priceSom: action.product.priceSom, quantity: 1 }] };
    }
    case 'inc':
      return { ...state, lines: state.lines.map(l => (l.productId === action.productId ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l)) };
    case 'dec': {
      const lines = state.lines.flatMap(l => (l.productId !== action.productId ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : []));
      return lines.length ? { ...state, lines } : emptyCart();
    }
    case 'remove': {
      const lines = state.lines.filter(l => l.productId !== action.productId);
      return lines.length ? { ...state, lines } : emptyCart();
    }
    case 'reprice': {
      const price = new Map(action.lines.map(l => [l.productId, l.unitSom]));
      return { ...state, lines: state.lines.map(l => (price.has(l.productId) ? { ...l, priceSom: price.get(l.productId)! } : l)) };
    }
    case 'drop': {
      const lines = state.lines.filter(l => !action.productIds.includes(l.productId));
      return lines.length ? { ...state, lines } : emptyCart();
    }
    case 'clear':
      return emptyCart();
  }
}

export const cartCount = (c: CartState): number => c.lines.reduce((n, l) => n + l.quantity, 0);
export const cartTotal = (c: CartState): number => c.lines.reduce((n, l) => n + l.priceSom * l.quantity, 0);
export const qtyOf = (c: CartState, productId: string): number => c.lines.find(l => l.productId === productId)?.quantity ?? 0;

const isLine = (x: unknown): x is CartLine => {
  const l = x as CartLine;
  return !!l && typeof l.productId === 'string' && typeof l.name === 'string' && Number.isSafeInteger(l.priceSom) && l.priceSom >= 0
    && Number.isSafeInteger(l.quantity) && l.quantity >= 1 && l.quantity <= MAX_QTY;
};

/** Storage may be missing, full, blocked or corrupted (Telegram webviews, private mode). Anything unusable becomes an empty cart. */
export function loadCart(storage: Pick<Storage, 'getItem'> | null | undefined): CartState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (typeof parsed.restaurantId !== 'string' || !Array.isArray(parsed.lines)) return emptyCart();
    const lines = parsed.lines.filter(isLine).slice(0, MAX_LINES);
    return lines.length ? { restaurantId: parsed.restaurantId, restaurantName: typeof parsed.restaurantName === 'string' ? parsed.restaurantName : null, lines } : emptyCart();
  } catch { return emptyCart(); }
}

export function saveCart(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, cart: CartState): void {
  try {
    if (!cart.lines.length) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch { /* quota / blocked: the cart simply is not remembered */ }
}
