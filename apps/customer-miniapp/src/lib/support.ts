import { useEffect, useState } from 'react';
import { t, T } from '../i18n';
import { api } from './api';
import type { CustomerStage, TicketStatus } from './types';

/** An order whose payment or delivery is stuck: the screen then offers "write about the problem" prominently (not just as a small link). */
export const STUCK_PAYMENT_MINUTES = 20;

export function troubleHint(o: { stage: CustomerStage; createdAt: string; serverNow: string }, payLeftSeconds: number | null): string | null {
  switch (o.stage) {
    case 'EXPIRED': return t('To‘lov vaqti tugadi. Agar pul o‘tkazgan bo‘lsangiz, shu haqda yozing — tekshirib beramiz.');
    case 'NEEDS_HELP': return t('Yetkazishda muammo chiqdi. Savolingiz bo‘lsa yozing.');
    case 'PAYMENT_PENDING': return payLeftSeconds !== null && payLeftSeconds <= 0 ? t('To‘lov vaqti tugayapti. Pul o‘tkazgan bo‘lsangiz, shu haqda yozing.') : null;
    case 'PAYMENT_CHECKING': {
      const minutes = (Date.parse(o.serverNow) - Date.parse(o.createdAt)) / 60_000;
      return minutes >= STUCK_PAYMENT_MINUTES ? t('To‘lovingiz uzoq tasdiqlanmayapti. Pul o‘tkazgan bo‘lsangiz, shu haqda yozing.') : null;
    }
    default: return null;
  }
}

/** "2× Lavash, 1× Cola +1 ta"; null for an older backend that sends no dish list. */
export function itemsLine(o: { itemsPreview?: Array<{ name: string; quantity: number }>; itemsMore?: number }): string | null {
  if (!o.itemsPreview || o.itemsPreview.length === 0) return null;
  const text = o.itemsPreview.map(i => `${i.quantity}× ${i.name}`).join(', ');
  return o.itemsMore && o.itemsMore > 0 ? t('{text} +{n} ta', { text, n: o.itemsMore }) : text;
}

export const TICKET_LABEL: Record<TicketStatus, string> = { OPEN: T('Yuborildi'), IN_PROGRESS: T('Ko‘rilmoqda'), RESOLVED: T('Hal qilindi') }; // shown through t(TICKET_LABEL[status])
export const TICKET_MIN = 5;
export const TICKET_MAX = 1000;
export const validTicketText = (text: string): boolean => { const n = text.trim().length; return n >= TICKET_MIN && n <= TICKET_MAX; };

/** How many of the customer's conversations have an answer they have not opened yet (the tab badge). Quiet polling while the page is visible. */
export function useSupportUnread(routeKey: string): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () => { api.ticketsUnread().then(r => { if (alive) setUnread(r.unread); }, () => { /* keep the last count */ }); };
    const start = () => { stop(); load(); timer = window.setInterval(load, 30_000); };
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { alive = false; document.removeEventListener('visibilitychange', vis); stop(); };
  }, [routeKey]);
  return unread;
}
