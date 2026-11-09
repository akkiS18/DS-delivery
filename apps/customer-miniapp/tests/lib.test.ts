import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { cartCount, cartReducer, cartTotal, cartView, emptyCart, loadCart, MAX_QTY, saveCart, STORAGE_KEY } from '../src/lib/cart';
import { describeCheckoutError } from '../src/lib/checkoutErrors';
import { mmss, opensText, som } from '../src/lib/format';
import { isTerminal, pollIntervalMs, timeline } from '../src/lib/order';
import { parentOf, parseRoute, routeToHash } from '../src/lib/router';
import { checkoutReady, formatPhone, normalizePhone, validateAddress } from '../src/lib/validation';

const add = (s = emptyCart(), id = 'p1', price = 10000, r = 'r1') => cartReducer(s, { type: 'add', restaurantId: r, restaurantName: 'R', product: { id, name: id, priceSom: price } });

describe('cart', () => {
  it('adds, increments, decrements and empties', () => {
    let s = add(); s = add(s);
    expect(cartCount(s)).toBe(2); expect(cartTotal(s)).toBe(20000);
    s = cartReducer(s, { type: 'dec', productId: 'p1' }); s = cartReducer(s, { type: 'dec', productId: 'p1' });
    expect(s).toEqual(emptyCart());
  });
  it('caps quantity', () => {
    let s = add();
    for (let i = 0; i < 50; i++) s = cartReducer(s, { type: 'inc', productId: 'p1' });
    expect(s.lines[0]!.quantity).toBe(MAX_QTY);
  });
  it('starts a fresh cart for another restaurant', () => {
    const s = add(add(), 'x', 5, 'r2');
    expect(s.restaurantId).toBe('r2'); expect(s.lines).toHaveLength(1);
  });
  it('reprices and drops lines', () => {
    let s = add(add(), 'p2', 5000);
    s = cartReducer(s, { type: 'reprice', lines: [{ productId: 'p1', unitSom: 12000 }] });
    expect(cartTotal(s)).toBe(17000);
    s = cartReducer(s, { type: 'drop', productIds: ['p1', 'p2'] });
    expect(s).toEqual(emptyCart());
  });
  it('carries a dish description and earlier price into the cart and shows the deal saving (display only: the total is unchanged)', () => {
    const set = { id: 'set', name: 'DONAR 3+1', priceSom: 109000, description: '3+1: 4 ta donar (1 tasi bonus) va 1 litrlik Coca-Cola', oldPriceSom: 125000 };
    let s = cartReducer(emptyCart(), { type: 'add', restaurantId: 'r1', restaurantName: 'R', product: set });
    s = cartReducer(s, { type: 'inc', productId: 'set' });
    expect(s.lines[0]!.description).toBe(set.description);
    const v = cartView(s);
    expect(v.totalSom).toBe(218000);
    expect(v.lines[0]!.wasSom).toBe(125000);
    expect(v.dealSavedSom).toBe(32000);
    // an older saved cart has neither; the menu fills them in (and a second identical fill changes nothing)
    const old = add(add(), 'p2', 5000);
    expect(old.lines[0]!.description).toBeUndefined();
    const filled = cartReducer(old, { type: 'catalog', restaurantId: 'r1', promos: [], packaging: {}, details: { p1: { description: 'Tavsif', oldPriceSom: 12000 }, p2: { description: null, oldPriceSom: null } } });
    expect(filled.lines.map(l => l.description)).toEqual(['Tavsif', null]);
    expect(cartView(filled).dealSavedSom).toBe(2000);
    expect(cartReducer(filled, { type: 'catalog', restaurantId: 'r1', promos: [], packaging: {}, details: { p1: { description: 'Tavsif', oldPriceSom: 12000 }, p2: { description: null, oldPriceSom: null } } })).toBe(filled);
    expect(cartView(old).dealSavedSom).toBe(0);
  });
  it('survives corrupted, hostile and missing storage', () => {
    const mk = (v: string | null) => ({ getItem: () => v });
    expect(loadCart(mk('{not json'))).toEqual(emptyCart());
    expect(loadCart(mk('null'))).toEqual(emptyCart());
    expect(loadCart(mk(JSON.stringify({ restaurantId: 1, lines: [] })))).toEqual(emptyCart());
    expect(loadCart(mk(JSON.stringify({ restaurantId: 'r', lines: [{ productId: 'a', name: 'a', priceSom: -5, quantity: 1 }, { productId: 'b', name: 'b', priceSom: 5, quantity: 999 }] })))).toEqual(emptyCart());
    expect(loadCart(null)).toEqual(emptyCart());
    expect(loadCart({ getItem: () => { throw new Error('blocked'); } })).toEqual(emptyCart());
  });
  it('round-trips and tolerates a full/blocked store', () => {
    const mem = new Map<string, string>();
    const st = { setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), getItem: (k: string) => mem.get(k) ?? null };
    const s = add(add());
    saveCart(st, s);
    expect(loadCart(st)).toEqual(s);
    saveCart(st, emptyCart()); expect(mem.has(STORAGE_KEY)).toBe(false);
    expect(() => saveCart({ setItem: () => { throw new Error('quota'); }, removeItem: () => undefined }, s)).not.toThrow();
  });
});

describe('validation', () => {
  it('normalises Uzbek phones', () => {
    for (const v of ['90 123 45 67', '+998901234567', '998 90 123-45-67', '(90) 123 45 67']) expect(normalizePhone(v)).toBe('+998901234567');
    for (const v of ['', '123', 'abc', '+99890123', '9012345678901']) expect(normalizePhone(v)).toBeNull();
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
  });
  it('validates addresses', () => {
    expect(validateAddress({ label: 'Uy', addressText: 'Chilonzor 5', lat: null, lng: null })).toEqual({});
    expect(Object.keys(validateAddress({ label: ' ', addressText: 'a', lat: null, lng: null })).sort()).toEqual(['addressText', 'label']);
    expect(validateAddress({ label: 'x'.repeat(31), addressText: 'abc', lat: null, lng: null }).label).toBeDefined();
    // the name is optional (the server numbers it): only the address text is required
    expect(validateAddress({ addressText: 'Chilonzor 5', lat: null, lng: null })).toEqual({});
    expect(Object.keys(validateAddress({ addressText: 'a', lat: null, lng: null }))).toEqual(['addressText']);
  });
  it('gates checkout on address and phone', () => {
    expect(checkoutReady({ addressText: 'Chilonzor', phone: '+998901234567' }).ok).toBe(true);
    expect(checkoutReady({ addressText: null, phone: null }).missing).toEqual(['address', 'phone']);
  });
});

describe('router', () => {
  it('round-trips and rejects junk', () => {
    for (const r of [{ name: 'home' }, { name: 'cart' }, { name: 'checkout' }, { name: 'orders' }, { name: 'profile' }, { name: 'menu', id: 'abc_1' }, { name: 'order', id: 'o-9' }] as const) {
      expect(parseRoute(routeToHash(r))).toEqual(r);
    }
    expect(parseRoute('#/menu/../../x')).toEqual({ name: 'home' });
    expect(parseRoute('#/menu/<script>')).toEqual({ name: 'home' });
    expect(parseRoute('#/cart/extra')).toEqual({ name: 'home' });
  });
  it('a support conversation can be about no order (#/support/new) or about one (#/support/new/<order>)', () => {
    expect(parseRoute('#/support/new')).toEqual({ name: 'supportNew' });
    expect(routeToHash({ name: 'supportNew' })).toBe('#/support/new');
    expect(parseRoute('#/support/new/o-9')).toEqual({ name: 'supportNew', orderId: 'o-9' });
    expect(routeToHash({ name: 'supportNew', orderId: 'o-9' })).toBe('#/support/new/o-9');
    expect(parseRoute('#/support/abc')).toEqual({ name: 'ticket', id: 'abc' });
    expect(parseRoute('#/support/new/a/b')).toEqual({ name: 'home' });
  });
  it('back never loops', () => {
    expect(parentOf({ name: 'home' })).toBeNull();
    expect(parentOf({ name: 'checkout' })).toEqual({ name: 'cart' });
    expect(parentOf({ name: 'order', id: 'x' })).toEqual({ name: 'orders' });
  });
  it('a menu category is part of the route, and back from it returns to the category grid', () => {
    const r = { name: 'menu', id: 'r1', cat: 'c_9' } as const;
    expect(parseRoute(routeToHash(r))).toEqual(r);
    expect(parentOf(r)).toEqual({ name: 'menu', id: 'r1' });
    expect(parentOf({ name: 'menu', id: 'r1' })).toEqual({ name: 'home' });
    expect(parseRoute('#/menu/r1/<x>')).toEqual({ name: 'home' });
    expect(parseRoute('#/menu/r1/a/b')).toEqual({ name: 'home' });
  });
});

describe('order clock and timeline', () => {
  it('formats mm:ss', () => { expect(mmss(65)).toBe('1:05'); expect(mmss(-125)).toBe('2:05'); });
  it('keeps accepted and sent taxi as separate steps; nothing is delivered early', () => {
    const t = timeline({ stage: 'TAXI_ACCEPTED' });
    expect(t.find(s => s.key === 'TAXI_ACCEPTED')!.state).toBe('current');
    expect(t.find(s => s.key === 'TAXI_SENT')!.state).toBe('todo');
    expect(t.find(s => s.key === 'DELIVERED')!.state).toBe('todo');
    expect(timeline({ stage: 'DELIVERED' }).every(s => s.state === 'done')).toBe(true);
  });
  it('marks cancelled/expired/needs-help truthfully', () => {
    expect(timeline({ stage: 'CANCELLED' }).at(-1)!.state).toBe('bad');
    const nh = timeline({ stage: 'NEEDS_HELP' });
    expect(nh.find(s => s.key === 'TAXI_REQUESTED')!.state).toBe('bad');
    expect(nh.find(s => s.key === 'DELIVERED')!.state).toBe('todo');
  });
  it('polls by stage and stops when terminal', () => {
    expect(pollIntervalMs('PAYMENT_PENDING')).toBeLessThan(pollIntervalMs('PREPARING')!);
    expect(pollIntervalMs('DELIVERED')).toBeNull(); expect(isTerminal('EXPIRED')).toBe(true);
  });
});

describe('checkout errors', () => {
  it('turns NARX_OZGARGAN into a repricing instruction', () => {
    const d = describeCheckoutError(new ApiError(409, 'NARX_OZGARGAN', { currentTotalSom: 55000, currentLines: [{ productId: 'p', name: 'p', unitSom: 55000, quantity: 1, subtotalSom: 55000 }] }));
    expect(d.kind).toBe('PRICE'); expect(d.currentLines).toHaveLength(1); expect(d.message).toContain('pul olinmadi');
  });
  it('extracts unavailable products', () => {
    const d = describeCheckoutError(new ApiError(409, 'MAHSULOT_MAVJUD_EMAS', { issues: [{ kind: 'PRODUCT_UNAVAILABLE', productId: 'x' }] }));
    expect(d.unavailableIds).toEqual(['x']);
  });
  it('never leaks raw codes for unknown failures', () => {
    const d = describeCheckoutError(new ApiError(500, 'WEIRD_INTERNAL'));
    expect(d.message).not.toContain('WEIRD_INTERNAL');
    expect(describeCheckoutError(new Error('x')).kind).toBe('OTHER');
  });
});

describe('format', () => {
  it('formats money and opening hours', () => {
    expect(som(45000)).toBe('45 000 so‘m');
    expect(opensText({ dayOffset: 0, dayOfWeek: 3, time: '09:00' })).toBe('Bugun 09:00 da ochiladi');
    expect(opensText(null)).toBe('Hozir yopiq');
  });
});
