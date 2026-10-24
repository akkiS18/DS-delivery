import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, CarFront, ChefHat, ChevronRight, Clock3, CreditCard, PackageCheck, ReceiptText, type LucideIcon } from 'lucide-react';
import { Button, Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock, som } from '../lib/format';
import { STAGE_LABEL } from '../lib/order';
import { groupOrders, needsAttention, nextAction, prepHint } from '../lib/orderList';
import type { Route } from '../lib/router';
import type { CustomerStage, OrderSummary } from '../lib/types';
import { useNow } from '../state';

const STAGE_ICON: Record<CustomerStage, LucideIcon> = {
  PAYMENT_PENDING: CreditCard, PAYMENT_CHECKING: Clock3, PREPARING: ChefHat, READY: PackageCheck, TAXI_REQUESTED: CarFront,
  TAXI_ACCEPTED: CarFront, TAXI_SENT: CarFront, DELIVERED: PackageCheck, CANCELLATION_REQUESTED: Clock3, CANCELLED: AlertTriangle,
  EXPIRED: AlertTriangle, NEEDS_HELP: AlertTriangle,
};
const POLL_MS = 8000;

/** Loads the list, then refreshes it quietly while any order is active (and when the app returns to the foreground). */
function useOrders() {
  const [data, setData] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [received, setReceived] = useState(0);
  const inflight = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (inflight.current) return;
    inflight.current = true;
    try { const r = await api.orders(signal); setReceived(performance.now()); setData(r.orders); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
    finally { inflight.current = false; }
  }, []);
  useEffect(() => { const ac = new AbortController(); void refresh(ac.signal); return () => ac.abort(); }, [refresh]);
  const anyActive = data ? groupOrders(data).active.length > 0 : true;
  useEffect(() => {
    if (!anyActive) return;
    let t: number | undefined;
    const stop = () => { if (t !== undefined) window.clearInterval(t); t = undefined; };
    const start = () => { stop(); t = window.setInterval(() => void refresh(), POLL_MS); };
    const vis = () => { if (document.hidden) stop(); else { void refresh(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [anyActive, refresh]);
  return { data, error, refresh, received };
}

export function Orders({ go }: { go: (r: Route) => void }) {
  const { data, error, refresh, received } = useOrders();
  const perfNow = useNow(30_000, true);
  if (!data && !error) return <div className="page"><Skeletons n={4} /></div>;
  if (!data) return <div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div>;
  const { active, history } = groupOrders(data);
  const open = (o: OrderSummary) => go({ name: 'order', id: o.id });
  const key = (o: OrderSummary) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(o); } };

  const activeCard = (o: OrderSummary) => {
    const hint = prepHint(o, perfNow, received);
    const taxi = o.stage.startsWith('TAXI_') && o.taxi?.companyName ? o.taxi.companyName : null;
    return (
      <div key={o.id} className={`card tap live ${needsAttention(o.stage) ? 'attn' : ''}`} role="button" tabIndex={0} onClick={() => open(o)} onKeyDown={key(o)}
        aria-label={`Buyurtma ${o.code}, ${o.restaurantName}, ${STAGE_LABEL[o.stage]}`}>
        <div className="ocard-head"><span className="bold">#{o.code} • {o.restaurantName}</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>
        <div className="status-line" style={{ marginTop: 8 }}><Icon as={STAGE_ICON[o.stage]} /><span>{STAGE_LABEL[o.stage]}</span></div>
        {(hint || taxi) && <div className="sub small" style={{ marginTop: 4 }}>{[hint, taxi].filter(Boolean).join(' • ')}</div>}
        <div className="row between" style={{ marginTop: 10 }}>
          <span className="sub small">{clock(o.createdAt)} • {o.itemsCount} ta</span>
          <span className="row bold" style={{ gap: 2, color: 'var(--primary)' }}>{nextAction(o.stage)}<Icon as={ChevronRight} size={18} /></span>
        </div>
      </div>
    );
  };
  const pastCard = (o: OrderSummary) => (
    <div key={o.id} className="card tap" role="button" tabIndex={0} onClick={() => open(o)} onKeyDown={key(o)}>
      <div className="row between"><span className="bold">#{o.code} • {o.restaurantName}</span><span className={`badge ${o.stage === 'DELIVERED' ? 'open' : 'closed'}`}>{STAGE_LABEL[o.stage]}</span></div>
      <div className="row between sub small" style={{ marginTop: 4 }}><span>{clock(o.createdAt)} • {o.itemsCount} ta</span><span className="mono">{som(o.foodTotalSom)}</span></div>
    </div>
  );

  return (
    <div className="page">
      <h1 className="page-title">Buyurtmalarim</h1>
      {error && <div className="banner warn" role="status">Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.</div>}
      {data.length === 0 && <Empty icon={<Icon as={ReceiptText} size={44} />} title="Hali buyurtma yo‘q" hint="Birinchi buyurtmangizni bering." action={<Button onClick={() => go({ name: 'home' })}>Restoranlar</Button>} />}
      {data.length > 0 && (
        <section className="stack" aria-label="Faol buyurtmalar">
          <h2 className="sec-title">Faol buyurtmalar{active.length > 0 && <span className="count">{active.length}</span>}</h2>
          {active.length === 0
            ? <div className="card center stack"><p className="sub">Hozir faol buyurtma yo‘q.</p><Button variant="secondary" onClick={() => go({ name: 'home' })}>Restoranlar</Button></div>
            : active.map(activeCard)}
        </section>
      )}
      {history.length > 0 && (
        <section className="stack" aria-label="Buyurtmalar tarixi">
          <h2 className="sec-title">Buyurtmalar tarixi</h2>
          {history.map(pastCard)}
        </section>
      )}
    </div>
  );
}
