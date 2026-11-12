import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_LABEL, timeline } from '../src/lib/order';
import { groupOrders, needsAttention, nextAction } from '../src/lib/orderList';
import type { CustomerStage } from '../src/lib/types';
import { keyboardOffset, keyboardOpen, navMode, nextBaseline } from '../src/lib/viewport';

const o = (id: string, stage: CustomerStage, createdAt = '2026-10-19T10:00:00Z') => ({ id, stage, createdAt });

describe('active order grouping', () => {
  it('classifies by the backend stage only', () => {
    const g = groupOrders([o('1', 'DELIVERED'), o('2', 'PREPARING'), o('3', 'CANCELLED'), o('4', 'EXPIRED'), o('5', 'NEEDS_HELP'), o('6', 'CANCELLATION_REQUESTED')]);
    expect(g.active.map(x => x.id).sort()).toEqual(['2', '5', '6']);
    expect(g.history.map(x => x.id).sort()).toEqual(['1', '3', '4']);
  });
  it('puts the most relevant first, then newest', () => {
    const g = groupOrders([o('prep', 'PREPARING'), o('pay-old', 'PAYMENT_PENDING', '2026-10-19T08:00:00Z'), o('pay-new', 'PAYMENT_PENDING', '2026-10-19T09:00:00Z'), o('help', 'NEEDS_HELP'), o('sent', 'TAXI_SENT')]);
    expect(g.active.map(x => x.id)).toEqual(['help', 'pay-new', 'pay-old', 'sent', 'prep']);
  });
  it('lists history newest first and drops duplicate ids', () => {
    const g = groupOrders([o('a', 'DELIVERED', '2026-10-18T10:00:00Z'), o('b', 'CANCELLED', '2026-10-19T10:00:00Z'), o('a', 'DELIVERED', '2026-10-18T10:00:00Z')]);
    expect(g.history.map(x => x.id)).toEqual(['b', 'a']);
  });
  it('handles zero orders and zero active orders', () => {
    expect(groupOrders([])).toEqual({ active: [], history: [] });
    expect(groupOrders([o('a', 'DELIVERED')]).active).toEqual([]);
  });
});

describe('status wording', () => {
  it('uses the required customer labels', () => {
    expect(STAGE_LABEL.PAYMENT_PENDING).toBe('To‘lov kutilmoqda');
    expect(STAGE_LABEL.PREPARING).toBe('Tayyorlanmoqda');
  });
  it('never presents an accepted taxi as on the way', () => {
    expect(STAGE_LABEL.TAXI_ACCEPTED).not.toMatch(/yo‘l/i);
    expect(STAGE_LABEL.TAXI_SENT).toMatch(/yo‘l/i);
    const tl = timeline({ stage: 'TAXI_ACCEPTED' });
    expect(tl.find(s => s.key === 'TAXI_ACCEPTED')?.state).toBe('current');
    expect(tl.find(s => s.key === 'TAXI_SENT')?.state).toBe('todo');
  });
  it('flags orders that need the customer and picks the action', () => {
    expect(needsAttention('PAYMENT_PENDING')).toBe(true);
    expect(needsAttention('PREPARING')).toBe(false);
    expect(nextAction('PREPARING')).toBe('Kuzatish');
    expect(nextAction('PAYMENT_PENDING')).toBe('To‘lash');
  });
});

describe('keyboard / viewport layout', () => {
  it('keeps the full bar on a normal viewport, degrades predictably when the keyboard shrinks it', () => {
    expect(navMode(800)).toBe('full');
    expect(navMode(460)).toBe('full');
    expect(navMode(380)).toBe('compact');
    expect(navMode(299)).toBe('inline');
    expect(navMode(0)).toBe('full');
    expect(navMode(NaN)).toBe('full');
  });
  it('hides the bar only while a field is focused AND the visible height really shrank', () => {
    expect(keyboardOpen(800, 480, true)).toBe(true);      // keyboard up
    expect(keyboardOpen(800, 800, true)).toBe(false);     // focused but no keyboard (hardware keyboard, back key closed it): the bar must return
    expect(keyboardOpen(800, 480, false)).toBe(false);    // short viewport without a focused field (split screen): never hidden
    expect(keyboardOpen(800, 720, true)).toBe(false);     // browser toolbar sized change
    expect(keyboardOpen(0, 480, true)).toBe(false);
    expect(keyboardOpen(NaN, 480, true)).toBe(false);
    expect(keyboardOpen(800, 0, true)).toBe(false);
  });
  it('keeps the baseline while a field is only briefly unfocused (search clear ×), so the bar stays hidden over the keyboard', () => {
    // Keyboard up: baseline 800, visible 480. Tapping the clear button blurs the field for an instant, the keyboard does not move.
    const blurred = nextBaseline(800, 480, false, false);
    expect(blurred).toBe(800);
    // Field focused again: still detected as open, the tab bar must not come back on top of the keyboard.
    expect(keyboardOpen(nextBaseline(blurred, 480, true, false), 480, true)).toBe(true);
    // Unfocused long enough (settled): the current height is the truth (split screen / keyboard really closed).
    expect(nextBaseline(800, 480, false, true)).toBe(480);
    expect(nextBaseline(480, 800, true, false)).toBe(800);
    expect(nextBaseline(800, 0, false, true)).toBe(800);
    expect(nextBaseline(800, NaN, true, false)).toBe(800);
  });
  it('lifts the bar only where the keyboard overlays the page', () => {
    expect(keyboardOffset(800, 800, 0)).toBe(0);         // Telegram resizes the WebView
    expect(keyboardOffset(800, 500, 0)).toBe(300);       // overlaid keyboard
    expect(keyboardOffset(800, 760, 0)).toBe(0);         // browser chrome change, not a keyboard
  });
});

describe('search focus / navigation persistence (source contract)', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
  it('the search clear button does not take focus from the field', () => {
    expect(read('screens/Home.tsx')).toMatch(/searchbox-clear" onPointerDown=\{e => e\.preventDefault\(\)\}/);
  });
  it('does not hide the tab bar on focus', () => {
    expect(read('components/ui.tsx')).not.toMatch(/useTyping|hidden=\{/);
    expect(read('styles.css')).not.toMatch(/data-typing/);
  });
  it('remembers the home search across navigation', () => {
    expect(read('screens/Home.tsx')).toMatch(/rememberedSearch/);
  });
  it('orders tab shows the active orders with an empty state and one button to the history screen, which has its own title', () => {
    const s = read('screens/Orders.tsx');
    for (const t of ['Faol buyurtmalar', 'Hozir faol buyurtma yo‘q', 'nextAction', 'Tarixni ko‘rish']) expect(s).toContain(t);
    expect(read('screens/History.tsx')).toContain('Buyurtmalar tarixi');
  });
});
