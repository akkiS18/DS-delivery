import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, Users } from 'lucide-react';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { som } from '../lib/format';
import { isOpenReservation, splitReservations, STATUS_LABEL, whenText } from '../lib/reservation';
import type { Route } from '../lib/router';
import type { ReservationView } from '../lib/types';

/** The customer's table reservations: the coming ones first, then the earlier and the unpaid-and-expired. */
export function Reservations({ go }: { go: (r: Route) => void }) {
  const [list, setList] = useState<ReservationView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setList((await api.reservations(signal)).reservations); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, []);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal); return () => ac.abort(); }, [load]);

  if (!list && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!list) return <div className="page"><ErrorBox error={error} onRetry={() => void load()} /></div>;

  const { upcoming, past } = splitReservations(list, Date.now());
  const card = (r: ReservationView) => (
    <div key={r.id} className={`card tap ${isOpenReservation(r) ? 'live attn' : ''}`} role="button" tabIndex={0} onClick={() => go({ name: 'reservation', id: r.id })}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go({ name: 'reservation', id: r.id }); } }}
      aria-label={`Bron ${r.code}, ${r.restaurantName}, ${STATUS_LABEL[r.status]}`}>
      <div className="row between"><span className="bold">#{r.code} • {r.restaurantName}</span><span className={`badge ${r.status === 'PAID' ? 'open' : r.status === 'PENDING_PAYMENT' ? 'warn' : 'closed'}`}>{STATUS_LABEL[r.status]}</span></div>
      <div className="row between sub small" style={{ marginTop: 6 }}>
        <span className="row" style={{ gap: 6 }}><Icon as={CalendarClock} size={16} />{whenText(r.startsAt)}</span>
        <span className="row" style={{ gap: 6 }}><Icon as={Users} size={16} />{r.partySize}</span>
        <span className="mono">{som(r.depositSom)}</span>
        <Icon as={ChevronRight} size={18} />
      </div>
    </div>
  );

  return (
    <div className="page">
      <h1 className="page-title">Bronlarim</h1>
      {error && <div className="banner warn" role="status">Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.</div>}
      {list.length === 0 && <Empty icon={<Icon as={CalendarClock} size={44} />} title="Hali bron yo‘q" hint="Restoran menyusidagi “Joy bron qilish” tugmasi orqali stol band qiling." />}
      {upcoming.length > 0 && <section className="stack" aria-label="Kelgusi bronlar"><h2 className="sec-title">Kelgusi bronlar<span className="count">{upcoming.length}</span></h2>{upcoming.map(card)}</section>}
      {past.length > 0 && <section className="stack" aria-label="Oldingi bronlar"><h2 className="sec-title">Oldingi bronlar</h2>{past.map(card)}</section>}
    </div>
  );
}
