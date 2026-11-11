import type { KeyboardEvent } from 'react';
import { RateRow } from './RateRow';
import { som } from '../lib/format';
import { dayText } from '../lib/history';
import { STAGE_LABEL } from '../lib/order';
import type { OrderSummary } from '../lib/types';
import { t } from '../i18n';

/** A finished order in the history list: when, how many dishes, how much, and the rating (or the stars to give one). */
export function PastOrderCard({ o, nowMs, open, onRated }: { o: OrderSummary; nowMs: number; open: () => void; onRated: () => void }) {
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  return (
    <div className="card tap" role="button" tabIndex={0} onClick={open} onKeyDown={key}>
      <div className="row between"><span className="bold">#{o.code} • {o.restaurantName}</span><span className={`badge ${o.stage === 'DELIVERED' ? 'open' : 'closed'}`}>{t(STAGE_LABEL[o.stage])}</span></div>
      <div className="row between sub small" style={{ marginTop: 4 }}><span>{dayText(o.createdAt, nowMs)} • {t('{n} ta', { n: o.itemsCount })}</span><span className="mono">{som(o.foodTotalSom)}</span></div>
      {o.stage === 'DELIVERED' && <RateRow orderId={o.id} rating={o.rating ?? null} canRate={o.canRate ?? false} onSaved={onRated} />}
    </div>
  );
}
