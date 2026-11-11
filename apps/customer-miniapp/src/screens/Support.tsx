import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, MessageSquarePlus } from 'lucide-react';
import { CottonPattern } from '../components/CottonPattern';
import { Empty, ErrorBox, Icon, Sheet, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock, som } from '../lib/format';
import { haptic } from '../lib/telegram';
import type { Route } from '../lib/router';
import { itemsLine, TICKET_LABEL } from '../lib/support';
import { STAGE_LABEL } from '../lib/order';
import type { OrderSummary, TicketSummary } from '../lib/types';
import { t } from '../i18n';

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
    let timer: number | undefined;
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const start = () => { stop(); timer = window.setInterval(() => void load(), POLL_MS); };
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
    <>
      <header className="home-head">
        <CottonPattern id="cottonSupport" />
        <div className="sup-intro">
          <h1 className="home-title">{t('Yordam')}</h1>
          <p>{t('Savol yoki muammo bo‘lsa, shu yerga yozing. Javobni ham shu yerda ko‘rasiz.')}</p>
        </div>
        <button type="button" className="sup-cta" onClick={() => { haptic.tap(); go({ name: 'supportNew' }); }}><Icon as={MessageSquarePlus} size={20} />{t('Yangi murojaat yozish')}</button>
        <button type="button" className="sup-cta ghost" onClick={() => { haptic.tap(); void choose(); }}>{t('Buyurtma haqida yozish')}</button>
      </header>
      <div className="page" style={{ paddingTop: 20 }}>
      {error &&<div className="banner warn" role="status">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}

      {tickets.length === 0
        ? <Empty icon={<Icon as={MessageCircle} size={44} />} title={t('Murojaatlar yo‘q')} hint={t('Savol yoki muammo bo‘lsa, yuqoridagi tugma orqali yozing.')} />
        : (
          <section className="stack" aria-label={t('Murojaatlarim')}>
            <h2 className="sec-title">{t('Murojaatlarim')}</h2>
            {tickets.map(tk => (
              <div key={tk.id} className={`tcard ${tk.unread ? 'unread' : ''} ${tk.status === 'RESOLVED' && !tk.unread ? 'done' : ''}`} role="button" tabIndex={0} onClick={() => go({ name: 'ticket', id: tk.id })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go({ name: 'ticket', id: tk.id }); } }}
                aria-label={(tk.orderId ? t('Murojaat {number}, buyurtma {code}, {status}', { number: tk.number, code: tk.orderCode, status: t(TICKET_LABEL[tk.status]) }) : t('Murojaat {number}, umumiy, {status}', { number: tk.number, status: t(TICKET_LABEL[tk.status]) })) + (tk.unread ? `, ${t('yangi javob')}` : '')}>
                <div className="tcard-head">
                  <span className="tcard-name">{tk.orderId ? `#${tk.orderCode} • ${tk.restaurantName}` : t('Umumiy murojaat')}</span>
                  {tk.unread ? <span className="tbadge new">{t('Yangi javob')}</span> : <span className={`tbadge ${tk.status === 'RESOLVED' ? 'done' : ''}`}>{t(TICKET_LABEL[tk.status])}</span>}
                </div>
                <div className="tcard-last"><b className={tk.lastFrom === 'ADMIN' ? 'them' : ''}>{tk.lastFrom === 'ADMIN' ? t('Yordam:') : t('Siz:')}</b> {tk.lastText}</div>
                <div className="tcard-meta">{t('Murojaat #{number}', { number: tk.number })} • {clock(tk.lastAt)}</div>
              </div>
            ))}
          </section>
        )}
      </div>

      {picking && (
        <Sheet title={t('Qaysi buyurtma haqida?')} onClose={() => setPicking(false)}>
          {!orders
            ? <Skeletons n={2} />
            : orders.length === 0
              ? <p className="sub">{t('Murojaat buyurtma bo‘yicha yoziladi. Avval buyurtma bering.')}</p>
              : (
                <div className="stack">
                  {orders.map(o => (
                    <button key={o.id} type="button" className="opick" onClick={() => { setPicking(false); go({ name: 'supportNew', orderId: o.id }); }}>
                      <span className="row between"><span className="bold">#{o.code} • {o.restaurantName}</span><span className="mono">{som(o.foodTotalSom)}</span></span>
                      {itemsLine(o) && <span className="opick-items">{itemsLine(o)}</span>}
                      <span className="sub small">{clock(o.createdAt)} • {t(STAGE_LABEL[o.stage])}</span>
                    </button>
                  ))}
                </div>
              )}
        </Sheet>
      )}
    </>
  );
}
