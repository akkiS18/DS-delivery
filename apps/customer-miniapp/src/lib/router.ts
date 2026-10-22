export type Route =
  | { name: 'home' }
  | { name: 'menu'; id: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'order'; id: string }
  | { name: 'orders' }
  | { name: 'profile' };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Hash routes (#/menu/<id>) work under any static host and inside Telegram without server-side routing. Unknown input -> home. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = parts;
  if (parts.length === 0) return { name: 'home' };
  if (a === 'menu' && b && ID.test(b) && parts.length === 2) return { name: 'menu', id: b };
  if (a === 'order' && b && ID.test(b) && parts.length === 2) return { name: 'order', id: b };
  if (parts.length === 1) {
    if (a === 'cart') return { name: 'cart' };
    if (a === 'checkout') return { name: 'checkout' };
    if (a === 'orders') return { name: 'orders' };
    if (a === 'profile') return { name: 'profile' };
  }
  return { name: 'home' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'menu': return `#/menu/${r.id}`;
    case 'order': return `#/order/${r.id}`;
    case 'cart': return '#/cart';
    case 'checkout': return '#/checkout';
    case 'orders': return '#/orders';
    case 'profile': return '#/profile';
  }
}

/** Where "back" goes. Explicit, so the Telegram back button never leaves the app or loops. */
export function parentOf(r: Route): Route | null {
  switch (r.name) {
    case 'home': return null;
    case 'menu': return { name: 'home' };
    case 'cart': return { name: 'home' };
    case 'checkout': return { name: 'cart' };
    case 'order': return { name: 'orders' };
    case 'orders':
    case 'profile': return { name: 'home' };
  }
}

export const isTab = (r: Route): boolean => r.name === 'home' || r.name === 'orders' || r.name === 'profile';
