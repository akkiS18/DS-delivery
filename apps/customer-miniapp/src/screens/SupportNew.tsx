import { useEffect, useState } from 'react';
import { Button, ErrorBox, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock } from '../lib/format';
import type { Route } from '../lib/router';
import { TICKET_MAX, TICKET_MIN, validTicketText } from '../lib/support';
import { som } from '../lib/format';
import type { OrderView } from '../lib/types';
import { useApp } from '../state';

/** Starts a conversation about one order. An order that already has an open conversation goes straight to it. */
export function SupportNew({ orderId, go }: { orderId: string; go: (r: Route, o?: { replace?: boolean }) => void }) {
  const { toast } = useApp();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [o, t] = await Promise.all([api.order(orderId, ac.signal), api.tickets(ac.signal)]);
        const open = t.tickets.find(x => x.orderId === orderId && x.status !== 'RESOLVED');
        if (open) { go({ name: 'ticket', id: open.id }, { replace: true }); return; }
        setOrder(o.order);
      } catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
    })();
    return () => ac.abort();
  }, [orderId, go]);

  if (!order && !error) return <div className="page"><Skeletons n={2} /></div>;
  if (!order) return <div className="page"><ErrorBox error={error} /></div>;

  const send = async () => {
    setTouched(true);
    if (!validTicketText(text) || busy) return;
    setBusy(true);
    try {
      const r = await api.openTicket(order.id, text.trim());
      toast('Murojaatingiz yuborildi');
      go({ name: 'ticket', id: r.ticketId }, { replace: true });
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'KOP_OCHIQ_MUROJAAT' ? 'Ochiq murojaatlar ko‘p. Avval ularning javobini kuting' : e instanceof ApiError && e.status === 429 ? 'Biroz kuting va qayta urinib ko‘ring' : 'Yuborib bo‘lmadi. Qayta urinib ko‘ring');
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <h1 className="page-title">Muammo haqida yozish</h1>
      <div className="card">
        <div className="row between"><span className="bold">#{order.code} • {order.restaurantName}</span><span className="mono">{som(order.foodTotalSom)}</span></div>
        <div className="opick-items">{order.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</div>
        <div className="sub small">{clock(order.createdAt)}</div>
      </div>
      <div className="field">
        <label htmlFor="sup-text">Nima bo‘ldi?</label>
        <textarea id="sup-text" className={`input ${touched && !validTicketText(text) ? 'invalid' : ''}`} rows={6} maxLength={TICKET_MAX} value={text}
          placeholder="Masalan: pulni o‘tkazdim, lekin buyurtma tasdiqlanmadi. Summa va vaqtni yozing." onChange={e => setText(e.target.value)} />
        {touched && !validTicketText(text) && <div className="err">Kamida {TICKET_MIN} ta belgi yozing</div>}
        <div className="sub small" style={{ textAlign: 'right' }}>{text.trim().length}/{TICKET_MAX}</div>
      </div>
      <Button loading={busy} onClick={() => void send()}>Yuborish</Button>
    </div>
  );
}
