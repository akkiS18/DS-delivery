import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, MessageCircle } from 'lucide-react';
import { Button, Empty, ErrorBox, Icon, Sheet, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock } from '../lib/format';
import type { Route } from '../lib/router';
import { TICKET_LABEL } from '../lib/support';
import type { OrderSummary, TicketSummary } from '../lib/types';

const POLL_MS = 15_000;

/** The help tab: the customer's conversations with the support team, and a way to start a new one for any of their orders. */
export function Support({ go }: { go: (r: Route) => void }) {
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setTickets((await api.tickets(signal)).tickets); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, []);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal); return () => ac.abort(); }, [load]);
  useEffect(() => {
    let t: number | undefined;
    const stop = () => { if (t !== undefined) window.clearInterval(t); t = undefined; };
    const start = () => { stop(); t = window.setInterval(() => void load(), POLL_MS); };
    const vis = () => { if (document.hidden) stop(); else { void load(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [load]);

  const choose = async () => {
    setPicking(true);
    if (!orders) { try { setOrders((await api.orders()).orders.slice(0, 10)); } catch { setOrders([]); } }
  };

  if (!tickets && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!tickets) return <div className="page"><ErrorBox error={error} onRetry={() => void load()} /></div>;

  return (
    <div className="page">
      <h1 className="page-title">Yordam</h1>
      <div className="banner" role="note">Buyurtma bo‘yicha muammo yoki savol bo‘lsa, shu yerga yozing. Javobni ham shu yerda ko‘rasiz.</div>
      <Button onClick={() => void choose()}>Yangi murojaat yozish</Button>
      {error && <div className="banner warn" role="status">Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.</div>}

      {tickets.length === 0
        ? <Empty icon={<Icon as={LifeBuoy} size={44} />} title="Murojaatlar yo‘q" hint="Muammo bo‘lsa, yuqoridagi tugma orqali yozing." />
        : (
          <section className="stack" aria-label="Murojaatlarim">
            <h2 className="sec-title">Murojaatlarim</h2>
            {tickets.map(t => (
              <div key={t.id} className={`card tap ${t.unread ? 'attn' : ''}`} role="button" tabIndex={0} onClick={() => go({ name: 'ticket', id: t.id })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go({ name: 'ticket', id: t.id }); } }}
                aria-label={`Murojaat ${t.number}, buyurtma ${t.orderCode}, ${TICKET_LABEL[t.status]}${t.unread ? ', yangi javob' : ''}`}>
                <div className="row between">
                  <span className="bold">#{t.orderCode} • {t.restaurantName}</span>
                  {t.unread ? <span className="badge warn">Yangi javob</span> : <span className={`badge ${t.status === 'RESOLVED' ? 'closed' : 'open'}`}>{TICKET_LABEL[t.status]}</span>}
                </div>
                <div className="ticket-snippet"><Icon as={MessageCircle} size={16} className="shrink" /><span>{t.lastFrom === 'ADMIN' ? 'Yordam: ' : 'Siz: '}{t.lastText}</span></div>
                <div className="sub small" style={{ marginTop: 6 }}>Murojaat #{t.number} • {clock(t.lastAt)}</div>
              </div>
            ))}
          </section>
        )}

      {picking && (
        <Sheet title="Qaysi buyurtma haqida?" onClose={() => setPicking(false)}>
          {!orders
            ? <Skeletons n={2} />
            : orders.length === 0
              ? <p className="sub">Murojaat buyurtma bo‘yicha yoziladi. Avval buyurtma bering.</p>
              : (
                <div className="stack">
                  {orders.map(o => (
                    <Button key={o.id} variant="secondary" onClick={() => { setPicking(false); go({ name: 'supportNew', orderId: o.id }); }}>#{o.code} • {o.restaurantName} • {clock(o.createdAt)}</Button>
                  ))}
                </div>
              )}
        </Sheet>
      )}
    </div>
  );
}
