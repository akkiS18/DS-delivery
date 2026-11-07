export type Route =
  | { name: 'home' }
  | { name: 'menu'; id: string; cat?: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'order'; id: string }
  | { name: 'orders' }
  | { name: 'reserve'; id: string }
  | { name: 'reservation'; id: string }
  | { name: 'reservations' }
  | { name: 'profile' }
  | { name: 'support' }
  | { name: 'ticket'; id: string }
  /** No orderId = a general question (the help tab); with one, the conversation is about that order. */
  | { name: 'supportNew'; orderId?: string | undefined };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Hash routes (#/menu/<id>) work under any static host and inside Telegram without server-side routing. Unknown input -> home. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = parts;
  if (parts.length === 0) return { name: 'home' };
  if (a === 'menu' && b && ID.test(b) && parts.length === 2) return { name: 'menu', id: b };
  if (a === 'menu' && b && ID.test(b) && parts.length === 3 && parts[2] && ID.test(parts[2])) return { name: 'menu', id: b, cat: parts[2] };
  if (a === 'order' && b && ID.test(b) && parts.length === 2) return { name: 'order', id: b };
  if (a === 'reserve' && b && ID.test(b) && parts.length === 2) return { name: 'reserve', id: b };
  if (a === 'reservation' && b && ID.test(b) && parts.length === 2) return { name: 'reservation', id: b };
  if (a === 'support' && b === 'new' && parts[2] && ID.test(parts[2]) && parts.length === 3) return { name: 'supportNew', orderId: parts[2] };
  if (a === 'support' && b === 'new' && parts.length === 2) return { name: 'supportNew' };
  if (a === 'support' && b && b !== 'new' && ID.test(b) && parts.length === 2) return { name: 'ticket', id: b };
  if (parts.length === 1) {
    if (a === 'cart') return { name: 'cart' };
    if (a === 'checkout') return { name: 'checkout' };
    if (a === 'orders') return { name: 'orders' };
    if (a === 'reservations') return { name: 'reservations' };
    if (a === 'profile') return { name: 'profile' };
    if (a === 'support') return { name: 'support' };
  }
  return { name: 'home' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'menu': return r.cat ? `#/menu/${r.id}/${r.cat}` : `#/menu/${r.id}`;
    case 'order': return `#/order/${r.id}`;
    case 'reserve': return `#/reserve/${r.id}`;
    case 'reservation': return `#/reservation/${r.id}`;
    case 'reservations': return '#/reservations';
    case 'cart': return '#/cart';
    case 'checkout': return '#/checkout';
    case 'orders': return '#/orders';
    case 'profile': return '#/profile';
    case 'support': return '#/support';
    case 'ticket': return `#/support/${r.id}`;
    case 'supportNew': return r.orderId ? `#/support/new/${r.orderId}` : '#/support/new';
  }
}

/** Where "back" goes. Explicit, so the Telegram back button never leaves the app or loops. */
export function parentOf(r: Route): Route | null {
  switch (r.name) {
    case 'home': return null;
    case 'menu': return r.cat ? { name: 'menu', id: r.id } : { name: 'home' };
    case 'cart': return { name: 'home' };
    case 'checkout': return { name: 'cart' };
    case 'order': return { name: 'orders' };
    case 'reserve': return { name: 'menu', id: r.id };
    case 'reservation': return { name: 'reservations' };
    case 'reservations': return { name: 'orders' };
    case 'ticket':
    case 'supportNew': return { name: 'support' };
    case 'orders':
    case 'profile':
    case 'support': return { name: 'home' };
  }
}

export const isTab = (r: Route): boolean => r.name === 'home' || r.name === 'cart' || r.name === 'orders' || r.name === 'support' || r.name === 'profile';

/** The floating basket button: any screen while the cart has something, except the basket itself, the checkout (own button) and the support conversation screens (own input). */
export const cartBarVisible = (r: Route, count: number): boolean =>
  count > 0 && r.name !== 'cart' && r.name !== 'checkout' && r.name !== 'reserve' && r.name !== 'ticket' && r.name !== 'supportNew';
