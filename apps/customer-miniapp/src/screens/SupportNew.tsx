import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock, newKey } from '../lib/format';
import type { Route } from '../lib/router';
import { TICKET_MAX, TICKET_MIN, validTicketText } from '../lib/support';
import { som } from '../lib/format';
import type { OrderView } from '../lib/types';
import { useApp } from '../state';
import { t } from '../i18n';

/**
 * Starts a conversation. Without an order (the help tab, owner 2026-11-07) the screen is already the chat: a greeting and the message box, the first
 * message opens the ticket; a customer who still has an unresolved general conversation goes straight back into it. With an order (from the order
 * screen) it is about that order, and an order that already has an open conversation goes straight to it.
 */
export function SupportNew({ orderId, go }: { orderId?: string | undefined; go: (r: Route, o?: { replace?: boolean }) => void }) {
  const { toast } = useApp();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checked, setChecked] = useState(false);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null); // one key per draft, so a retry after a lost answer can never post the same text twice

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        if (orderId) {
          const [o, list] = await Promise.all([api.order(orderId, ac.signal), api.tickets(ac.signal)]);
          const open = list.tickets.find(x => x.orderId === orderId && x.status !== 'RESOLVED');
          if (open) { go({ name: 'ticket', id: open.id }, { replace: true }); return; }
          setOrder(o.order);
        } else {
          const list = await api.tickets(ac.signal);
          const open = list.tickets.find(x => x.orderId === null && x.status !== 'RESOLVED');
          if (open) { go({ name: 'ticket', id: open.id }, { replace: true }); return; }
        }
        setChecked(true);
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
        if (orderId) setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK'));
        else setChecked(true); // the list is only a shortcut: the customer can still write
      }
    })();
    return () => ac.abort();
  }, [orderId, go]);

  if (!checked && !error) return <div className="page"><Skeletons n={2} /></div>;
  if (orderId && !order) return <div className="page"><ErrorBox error={error} /></div>;

  const send = async () => {
    setTouched(true);
    if (!validTicketText(text) || busy) return;
    key.current ??= newKey();
    setBusy(true);
    try {
      const message = text.trim();
      const r = orderId ? await api.openTicket(orderId, message) : await api.openGeneralTicket(message);
      // An open conversation already existed (written to from another phone / tab a moment ago): the text goes into it as a message.
      if (!r.created && !orderId) await api.sendTicketMessage(r.ticketId, message, key.current);
      toast(t('Murojaatingiz yuborildi'));
      go({ name: 'ticket', id: r.ticketId }, { replace: true });
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'KOP_OCHIQ_MUROJAAT' ? t('Ochiq murojaatlar ko‘p. Avval ularning javobini kuting') : e instanceof ApiError && e.status === 429 ? t('Biroz kuting va qayta urinib ko‘ring') : t('Yuborib bo‘lmadi. Qayta urinib ko‘ring'));
    } finally { setBusy(false); }
  };

  if (!orderId) {
    return (
      <div className="page chat">
        <div>
          <h1 className="page-title">{t('Yordam xizmati')}</h1>
          <p className="sub">{t('Javobni shu yerda ko‘rasiz.')}</p>
        </div>
        <div className="bubbles" role="log" aria-label={t('Yozishma')}>
          <div className="bubble theirs">
            <div className="who">{t('Yordam xizmati')}</div>
            <div className="txt">{t('Salom! Qanday yordam bera olamiz? Savol yoki muammoingizni yozing.')}</div>
          </div>
          {touched && !validTicketText(text) && <div className="err center">{t('Kamida {n} ta belgi yozing', { n: TICKET_MIN })}</div>}
        </div>
        <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          <textarea className="input" rows={2} maxLength={TICKET_MAX} value={text} placeholder={t('Xabar yozing…')} aria-label={t('Xabar')} autoFocus
            onChange={e => { setText(e.target.value); key.current = null; }} />
          <Button type="submit" loading={busy} disabled={!text.trim()} aria-label={t('Yuborish')}><Icon as={Send} size={20} /></Button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">{t('Muammo haqida yozish')}</h1>
      <div className="card">
        <div className="row between"><span className="bold">#{order!.code} • {order!.restaurantName}</span><span className="mono">{som(order!.foodTotalSom)}</span></div>
        <div className="opick-items">{order!.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</div>
        <div className="sub small">{clock(order!.createdAt)}</div>
      </div>
      <div className="field">
        <label htmlFor="sup-text">{t('Nima bo‘ldi?')}</label>
        <textarea id="sup-text" className={`input ${touched && !validTicketText(text) ? 'invalid' : ''}`} rows={6} maxLength={TICKET_MAX} value={text}
          placeholder={t('Masalan: pulni o‘tkazdim, lekin buyurtma tasdiqlanmadi. Summa va vaqtni yozing.')} onChange={e => setText(e.target.value)} />
        {touched && !validTicketText(text) && <div className="err">{t('Kamida {n} ta belgi yozing', { n: TICKET_MIN })}</div>}
        <div className="sub small" style={{ textAlign: 'right' }}>{text.trim().length}/{TICKET_MAX}</div>
      </div>
      <Button loading={busy} onClick={() => void send()}>{t('Yuborish')}</Button>
    </div>
  );
}
