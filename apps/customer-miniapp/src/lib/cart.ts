import { FLAT_PRICING, isPricing, priceLines, referenceUnitPrice, type PricedLine } from './fee';
import { freeUnits, isPromoDef } from './promo';
import type { CartLine, CartState, PublicPricing } from './types';

/** Pure cart logic + tolerant persistence. Prices stored here are only for display: the server re-reads every price at checkout. */
export const MAX_QTY = 30;
export const MAX_LINES = 20;
export const STORAGE_KEY = 'ds.cart.v1';

export const emptyCart = (pricing?: PublicPricing): CartState => ({ restaurantId: null, restaurantName: null, lines: [], ...(pricing ? { pricing } : {}) });

export type CartAction =
  | { type: 'add'; restaurantId: string; restaurantName: string; product: { id: string; name: string; priceSom: number; packaging?: CartLine['packaging']; description?: string | null; oldPriceSom?: number | null } }
  | { type: 'inc'; productId: string }
  | { type: 'dec'; productId: string }
  | { type: 'remove'; productId: string }
  | { type: 'pricing'; pricing: PublicPricing }
  /** The restaurant's menu as it is now: its 1+1 offers and the packaging of each dish (keeps the cart's extra lines in step with the server). */
  | { type: 'catalog'; restaurantId: string; promos: NonNullable<CartState['promos']>; packaging: Record<string, CartLine['packaging']>; details?: Record<string, { description: string | null; oldPriceSom: number | null }> }
  /** unitSom here is the restaurant's own price (the server's baseUnitSom). */
  | { type: 'reprice'; lines: Array<{ productId: string; unitSom: number }> }
  | { type: 'drop'; productIds: string[] }
  | { type: 'clear' };

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // One restaurant per order: adding from another restaurant starts a fresh cart (the UI asks the customer first).
      const base: CartState = state.restaurantId === action.restaurantId ? state : { ...emptyCart(state.pricing), restaurantId: action.restaurantId, restaurantName: action.restaurantName };
      const existing = base.lines.find(l => l.productId === action.product.id);
      if (existing) return { ...base, lines: base.lines.map(l => (l.productId === existing.productId ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l)) };
      if (base.lines.length >= MAX_LINES) return base;
      return { ...base, lines: [...base.lines, { productId: action.product.id, name: action.product.name, priceSom: action.product.priceSom, quantity: 1, ...(action.product.packaging ? { packaging: action.product.packaging } : {}), ...(action.product.description !== undefined ? { description: action.product.description } : {}), ...(action.product.oldPriceSom !== undefined ? { oldPriceSom: action.product.oldPriceSom } : {}) }] };
    }
    case 'inc':
      return { ...state, lines: state.lines.map(l => (l.productId === action.productId ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l)) };
    case 'dec': {
      const lines = state.lines.flatMap(l => (l.productId !== action.productId ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : []));
      return lines.length ? { ...state, lines } : emptyCart(state.pricing);
    }
    case 'remove': {
      const lines = state.lines.filter(l => l.productId !== action.productId);
      return lines.length ? { ...state, lines } : emptyCart(state.pricing);
    }
    case 'pricing':
      return JSON.stringify(state.pricing) === JSON.stringify(action.pricing) ? state : { ...state, pricing: action.pricing };
    case 'catalog': {
      if (state.restaurantId !== action.restaurantId) return state;
      const lines = state.lines.map(l => {
        const pk = action.packaging[l.productId] ?? null;
        const d = action.details?.[l.productId];
        const samePk = JSON.stringify(l.packaging ?? null) === JSON.stringify(pk);
        const sameDetails = !d || (l.description === d.description && l.oldPriceSom === d.oldPriceSom);
        if (samePk && sameDetails) return l;
        const { packaging: _old, ...rest } = l;
        return { ...rest, ...(pk ? { packaging: pk } : {}), ...(d ? { description: d.description, oldPriceSom: d.oldPriceSom } : {}) };
      });
      const same = JSON.stringify(state.promos ?? []) === JSON.stringify(action.promos) && lines.every((l, i) => l === state.lines[i]);
      return same ? state : { ...state, lines, promos: action.promos };
    }
    case 'reprice': {
      const price = new Map(action.lines.map(l => [l.productId, l.unitSom]));
      return { ...state, lines: state.lines.map(l => (price.has(l.productId) ? { ...l, priceSom: price.get(l.productId)! } : l)) };
    }
    case 'drop': {
      const lines = state.lines.filter(l => !action.productIds.includes(l.productId));
      return lines.length ? { ...state, lines } : emptyCart(state.pricing);
    }
    case 'clear':
      return emptyCart(state.pricing);
  }
}

/** The menu's side of the cart: 1+1 offers, packaging, and the description / earlier price of every dish (display only). */
export function catalogAction(menu: {
  restaurant: { id: string };
  products: Array<{ id: string; description?: string | null; oldPriceSom?: number | null; packaging?: CartLine['packaging'] }>;
  promotions?: Array<{ id: string; maxFreePerOrder: number | null; productIds: string[] }>;
}): Extract<CartAction, { type: 'catalog' }> {
  return {
    type: 'catalog', restaurantId: menu.restaurant.id,
    promos: (menu.promotions ?? []).map(p => ({ id: p.id, maxFreePerOrder: p.maxFreePerOrder, productIds: p.productIds })),
    packaging: Object.fromEntries(menu.products.map(p => [p.id, p.packaging ?? null])),
    details: Object.fromEntries(menu.products.map(p => [p.id, { description: p.description ?? null, oldPriceSom: p.oldPriceSom ?? null }])),
  };
}

export const cartCount = (c: CartState): number => c.lines.reduce((n, l) => n + l.quantity, 0);
/**
 * What the customer sees and pays for this cart: every dish at its current price (service fee included), the packaging lines ("soboy idishi", one per unit of
 * a dish that has it), the free units of a 1+1 offer, the total, and how much the basket saved. `lines` are the dishes the customer picked (quantity = picked;
 * freeQty of them are free, subtotalSom counts only the paid ones). `pricing` is the effective model: an order with a free unit has its platform line waived.
 */
export interface CartView {
  lines: Array<CartLine & PricedLine & { freeQty: number; wasSom: number }>;
  extras: Array<{ productId: string; name: string; quantity: number; unitSom: number; subtotalSom: number }>;
  baseTotalSom: number; dishesSom: number; totalSom: number; savedSom: number;
  /** Menu value of the free units (what the 1+1 offer saves the customer). */
  promoSavedSom: number;
  /** What the dishes' earlier (crossed-out) prices save on top of savedSom, for the paid units. */
  dealSavedSom: number;
  pricing: PublicPricing;
}
export function cartView(c: CartState): CartView {
  const stored = c.pricing ?? FLAT_PRICING;
  const free = freeUnits(c.lines.map(l => ({ productId: l.productId, baseUnitSom: l.priceSom, quantity: l.quantity })), (c.promos ?? []).map(p => ({ ...p })));
  const freeCount = [...free.values()].reduce((n, q) => n + q, 0);
  const pricing: PublicPricing = freeCount > 0 && stored.mode === 'LINE' && !stored.lineWaived ? { ...stored, lineWaived: true } : stored;
  const pack = new Map<string, { name: string; priceSom: number; quantity: number }>();
  for (const l of c.lines) if (l.packaging) {
    const cur = pack.get(l.packaging.id);
    pack.set(l.packaging.id, { name: l.packaging.name, priceSom: l.packaging.priceSom, quantity: (cur?.quantity ?? 0) + l.quantity });
  }
  const packList = [...pack.entries()].map(([id, p]) => ({ id, ...p }));
  const paidDishes = c.lines.map(l => ({ priceSom: l.priceSom, quantity: l.quantity - (free.get(l.productId) ?? 0) }));
  const r = priceLines([...paidDishes, ...packList.map(p => ({ priceSom: p.priceSom, quantity: p.quantity }))], pricing);
  // An empty cart has no platform line (priceLines checks the number of lines it was given, which is never 0 here once the cart has lines).
  const lines = c.lines.map((l, i) => {
    const priced = r.lines[i]!;
    const earlier = l.oldPriceSom && l.oldPriceSom > l.priceSom ? referenceUnitPrice(l.oldPriceSom, pricing) : 0;
    return { ...l, ...priced, freeQty: free.get(l.productId) ?? 0, wasSom: Math.max(priced.referenceSom, priced.unitSom, earlier) };
  });
  return {
    lines,
    extras: packList.map((p, i) => ({ productId: p.id, name: p.name, quantity: p.quantity, unitSom: r.lines[c.lines.length + i]!.unitSom, subtotalSom: r.lines[c.lines.length + i]!.subtotalSom })),
    baseTotalSom: r.baseTotalSom, dishesSom: r.dishesSom, totalSom: r.totalSom, savedSom: r.savedSom,
    dealSavedSom: lines.reduce((n, l) => n + (l.wasSom - Math.max(l.referenceSom, l.unitSom)) * (l.quantity - l.freeQty), 0),
    promoSavedSom: c.lines.reduce((n, l) => n + (free.get(l.productId) ?? 0) * l.priceSom, 0),
    pricing,
  };
}
export const cartTotal = (c: CartState): number => cartView(c).totalSom;
/** The restaurant's own prices added up (drives the progress bar). */
export const cartBase = (c: CartState): number => c.lines.reduce((n, l) => n + l.priceSom * l.quantity, 0);
export const qtyOf = (c: CartState, productId: string): number => c.lines.find(l => l.productId === productId)?.quantity ?? 0;

const isLine = (x: unknown): x is CartLine => {
  const l = x as CartLine;
  return !!l && typeof l.productId === 'string' && typeof l.name === 'string' && Number.isSafeInteger(l.priceSom) && l.priceSom >= 0
    && Number.isSafeInteger(l.quantity) && l.quantity >= 1 && l.quantity <= MAX_QTY
    && (l.description == null || typeof l.description === 'string') && (l.oldPriceSom == null || Number.isSafeInteger(l.oldPriceSom))
    && (l.packaging == null || (typeof l.packaging.id === 'string' && typeof l.packaging.name === 'string' && Number.isSafeInteger(l.packaging.priceSom) && l.packaging.priceSom >= 0));
};

/** Storage may be missing, full, blocked or corrupted (Telegram webviews, private mode). Anything unusable becomes an empty cart. */
export function loadCart(storage: Pick<Storage, 'getItem'> | null | undefined): CartState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (typeof parsed.restaurantId !== 'string' || !Array.isArray(parsed.lines)) return emptyCart();
    const lines = parsed.lines.filter(isLine).slice(0, MAX_LINES);
    return lines.length ? { restaurantId: parsed.restaurantId, restaurantName: typeof parsed.restaurantName === 'string' ? parsed.restaurantName : null, lines, ...(isPricing(parsed.pricing) ? { pricing: parsed.pricing } : {}), ...(Array.isArray(parsed.promos) && parsed.promos.every(isPromoDef) ? { promos: parsed.promos } : {}) } : emptyCart();
  } catch { return emptyCart(); }
}

export function saveCart(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, cart: CartState): void {
  try {
    if (!cart.lines.length) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch { /* quota / blocked: the cart simply is not remembered */ }
}
