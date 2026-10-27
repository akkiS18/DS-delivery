import { describe, expect, it } from 'vitest';
import { heroSteps, timeline } from '../src/lib/order';
import type { CustomerStage } from '../src/lib/types';

const view = (stage: CustomerStage) => heroSteps(stage)?.map(s => `${s.state}:${s.label}`);

describe('heroSteps: payment, cooking, delivery', () => {
  it('while paying, payment is the current step and the rest wait', () => {
    for (const s of ['PAYMENT_PENDING', 'PAYMENT_CHECKING'] as const) expect(view(s)).toEqual(['current:To‘lov', 'todo:Tayyorlanmoqda', 'todo:Yetkazilmoqda']);
  });

  it('once paid, cooking is the current step', () => {
    expect(view('PREPARING')).toEqual(['done:To‘lov', 'current:Tayyorlanmoqda', 'todo:Yetkazilmoqda']);
  });

  it('when the restaurant says ready, cooking becomes a check reading "Tayyor" and delivery is current (taxi booking stays inside it)', () => {
    for (const s of ['READY', 'TAXI_REQUESTED', 'TAXI_ACCEPTED', 'TAXI_SENT'] as const) expect(view(s)).toEqual(['done:To‘lov', 'done:Tayyor', 'current:Yetkazilmoqda']);
  });

  it('walking delivery reads like a delivery in progress and has no taxi steps in the timeline', () => {
    expect(view('SELF_DELIVERY')).toEqual(['done:To‘lov', 'done:Tayyor', 'current:Yetkazilmoqda']);
    const labels = timeline({ stage: 'SELF_DELIVERY', deliveryMode: 'SELF' }).map(s => s.label);
    expect(labels).toContain('Restoran olib bormoqda');
    expect(labels.some(l => /taksi|operator/i.test(l))).toBe(false);
    expect(timeline({ stage: 'TAXI_SENT' }).map(s => s.label)).toContain('Taksi yo‘lda');
  });

  it('only the operator-confirmed DELIVERED completes the third step, and there is no fourth', () => {
    expect(view('DELIVERED')).toEqual(['done:To‘lov', 'done:Tayyor', 'done:Yetkazildi']);
    expect(heroSteps('DELIVERED')).toHaveLength(3);
  });

  it('failed or cancelled orders show no steps', () => {
    for (const s of ['CANCELLED', 'EXPIRED', 'CANCELLATION_REQUESTED', 'NEEDS_HELP'] as const) expect(heroSteps(s)).toBeNull();
  });
});
