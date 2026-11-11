import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Send } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock, newKey } from '../lib/format';
import type { Route } from '../lib/router';
import { TICKET_LABEL, TICKET_MAX } from '../lib/support';
import type { TicketThread } from '../lib/types';
import { useApp } from '../state';
import { t } from '../i18n';

const POLL_OPEN_MS = 4_000;
const POLL_DONE_MS = 30_000;

/** One conversation with the support team. Admins answer from Telegram; their replies show up here within a few seconds. */
export function Ticket({ id, go }: { id: string; go: (r: Route) => void }) {
  const { toast } = useApp();
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null); // one key per unsent draft: a retry of the same text is a duplicate, not a second message
  const end = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setThread(await api.ticket(id, signal)); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, [id]);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal); return () => ac.abort(); }, [load]);

  const status = thread?.ticket.status;
  useEffect(() => {
    if (!status) return;
    const every = status === 'RESOLVED' ? POLL_DONE_MS : POLL_OPEN_MS;
    let timer: number | undefined;
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const start = () => { stop(); timer = window.setInterval(() => void load(), every); };
    const vis = () => { if (document.hidden) stop(); else { void load(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [status, load]);

  const n = thread?.messages.length ?? 0;
  useEffect(() => { if (n !== count.current) { count.current = n; end.current?.scrollIntoView({ block: 'end' }); } }, [n]);

  if (!thread && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!thread) return <div className="page"><ErrorBox error={error} onRetry={() => void load()} /></div>;
  const tk = thread.ticket;
  const resolved = tk.status === 'RESOLVED';

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    key.current ??= newKey();
    setBusy(true);
    try {
      await api.sendTicketMessage(tk.id, body, key.current);
      key.current = null; setText('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MUROJAAT_YOPILGAN') { toast(t('Murojaat hal qilingan')); await load(); }
      else toast(e instanceof ApiError && e.code === 'KOP_XABAR' ? t('Javob kelguncha biroz kuting') : e instanceof ApiError && e.status === 429 ? t('Biroz kuting va qayta urinib ko‘ring') : t('Yuborib bo‘lmadi. Qayta urinib ko‘ring'));
    } finally { setBusy(false); }
  };

  return (
    <>
    <header className="screen-head chat-head">
      <button type="button" className="round-back" onClick={() => go({ name: 'support' })} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>
      <div className="grow chat-head-text">
        <h1>{t('Murojaat #{number}', { number: tk.number })}</h1>
        {tk.orderId ? <a href={`#/order/${tk.orderId}`}>{t('Buyurtma #{code}', { code: tk.orderCode })} • {tk.restaurantName}</a> : <span>{t('Umumiy murojaat')}</span>}
      </div>
      <span className={`tbadge ${resolved ? 'done' : ''}`}>{t(TICKET_LABEL[tk.status])}</span>
    </header>
    <div className="page chat">
      {error && <div className="banner warn" role="status">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}
      <div className="bubbles" role="log" aria-live="polite" aria-label={t('Yozishma')}>
        {thread.messages.map(m => (
          <div key={m.id} className={`bubble ${m.from === 'CUSTOMER' ? 'mine' : 'theirs'}`}>
            {m.from === 'ADMIN' && <div className="who">{t('Yordam xizmati')}</div>}
            <div className="txt">{m.text}</div>
            <div className="at">{clock(m.at)}</div>
          </div>
        ))}
        {tk.status === 'OPEN' && <div className="sub small center">{t('Murojaatingiz qabul qilindi. Javobni shu yerda ko‘rasiz.')}</div>}
        <div ref={end} />
      </div>
      {resolved
        ? (
          <div className="stack">
            <div className="banner" role="status">{t('Murojaat hal qilingan. Muammo davom etsa, yangi murojaat yozing.')}</div>
            <Button onClick={() => go(tk.orderId ? { name: 'supportNew', orderId: tk.orderId } : { name: 'supportNew' })}>{t('Yangi murojaat')}</Button>
          </div>
        )
        : (
          <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
            <textarea className="input" rows={1} maxLength={TICKET_MAX} value={text} placeholder={t('Xabar yozing…')} aria-label={t('Xabar')}
              onChange={e => { setText(e.target.value); key.current = null; }} />
            <button type="submit" className="send-fab" disabled={busy || !text.trim()} aria-label={t('Yuborish')} aria-busy={busy || undefined}>
              {busy ? <span className="spinner" style={{ width: 20, height: 20, margin: 0, borderWidth: 2 }} /> : <Icon as={Send} size={22} />}
            </button>
          </form>
        )}
    </div>
    </>
  );
}
