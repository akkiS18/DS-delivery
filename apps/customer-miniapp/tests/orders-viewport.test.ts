import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_LABEL, timeline } from '../src/lib/order';
import { groupOrders, needsAttention, nextAction, prepHint } from '../src/lib/orderList';
import type { CustomerStage } from '../src/lib/types';
import { keyboardOffset, navMode } from '../src/lib/viewport';

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
  it('shows a prep hint only while preparing, on the server clock', () => {
    const prep = { minutes: 20, startedAt: null, estimatedReadyAt: '2026-10-19T10:10:00Z', readyAt: null, remainingSeconds: null, overdueMinutes: 0, isOverdue: false };
    const base = { prep, serverNow: '2026-10-19T10:00:00Z' };
    expect(prepHint({ ...base, stage: 'PREPARING' }, 0, 0)).toBe('~10 daqiqa qoldi');
    expect(prepHint({ ...base, stage: 'PREPARING' }, 11 * 60_000, 0)).toBe('Tez orada tayyor bo‘ladi');
    expect(prepHint({ ...base, stage: 'PAYMENT_PENDING' }, 0, 0)).toBeNull();
    expect(prepHint({ stage: 'PREPARING' }, 0, 0)).toBeNull();   // old backend without prep data
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
  it('lifts the bar only where the keyboard overlays the page', () => {
    expect(keyboardOffset(800, 800, 0)).toBe(0);         // Telegram resizes the WebView
    expect(keyboardOffset(800, 500, 0)).toBe(300);       // overlaid keyboard
    expect(keyboardOffset(800, 760, 0)).toBe(0);         // browser chrome change, not a keyboard
  });
});

describe('search focus / navigation persistence (source contract)', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
  it('does not hide the tab bar on focus', () => {
    expect(read('components/ui.tsx')).not.toMatch(/useTyping|hidden=\{/);
    expect(read('styles.css')).not.toMatch(/data-typing/);
  });
  it('remembers the home search across navigation', () => {
    expect(read('screens/Home.tsx')).toMatch(/rememberedSearch/);
  });
  it('orders screen has both sections and an empty state', () => {
    const s = read('screens/Orders.tsx');
    for (const t of ['Faol buyurtmalar', 'Buyurtmalar tarixi', 'Hozir faol buyurtma yo‘q', 'Kuzatish'.length ? 'nextAction' : '']) expect(s).toContain(t);
  });
});
