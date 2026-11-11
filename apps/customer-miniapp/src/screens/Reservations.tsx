import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { CalendarClock, ChevronRight, CreditCard } from 'lucide-react';
import { OrdersSwitch } from '../components/OrdersSwitch';
import { ReservationTicket } from '../components/ReservationTicket';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { som } from '../lib/format';
import { isOpenReservation, splitReservations, STATUS_LABEL, whenText } from '../lib/reservation';
import type { Route } from '../lib/router';
import type { ReservationView } from '../lib/types';
import { t } from '../i18n';

/** The customer's table reservations: the coming ones first, then the earlier and the unpaid-and-expired. */
export function Reservations({ go }: { go: (r: Route) => void }) {
  const [list, setList] = useState<ReservationView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setList((await api.reservations(signal)).reservations); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, []);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal); return () => ac.abort(); }, [load]);

  const head = <header className="page-head"><h1>{t('Bronlarim')}</h1><OrdersSwitch active="reservations" go={go} /></header>;
  if (!list && !error) return <>{head}<div className="page"><Skeletons n={3} /></div></>;
  if (!list) return <>{head}<div className="page"><ErrorBox error={error} onRetry={() => void load()} /></div></>;

  const { upcoming, past } = splitReservations(list, Date.now());
  const open = (r: ReservationView) => () => go({ name: 'reservation', id: r.id });
  const key = (r: ReservationView) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r)(); } };
  const label = (r: ReservationView) => t('Bron {code}, {name}, {status}', { code: r.code, name: r.restaurantName, status: t(STATUS_LABEL[r.status]) });
  // Paid and still ahead: the ticket. Waiting for the deposit: the yellow "pay" card (like an order). Everything else: a quiet grey card.
  const card = (r: ReservationView) => {
    if (r.status === 'PAID' && upcoming.includes(r)) return <ReservationTicket key={r.id} r={r} id={`cottonTkt${r.id}`} onOpen={open(r)} />;
    if (isOpenReservation(r)) {
      return (
        <div key={r.id} className="ocard pay" role="button" tabIndex={0} onClick={open(r)} onKeyDown={key(r)} aria-label={label(r)}>
          <div className="ocard-head"><span className="ocard-name">#{r.code} • {r.restaurantName}</span><span className="bold mono">{som(r.depositSom)}</span></div>
          <div className="ocard-mid">
            <span className="ocard-stage"><span className="ocard-ico" aria-hidden><Icon as={CreditCard} size={22} /></span><span>{t(STATUS_LABEL[r.status])}</span></span>
            <span className="ocard-go">{t('To‘lash')}<Icon as={ChevronRight} size={18} /></span>
          </div>
          <div className="ocard-sub">{whenText(r.startsAt)} • {t('{n} kishi', { n: r.partySize })}</div>
        </div>
      );
    }
    return (
      <div key={r.id} className="pastres" role="button" tabIndex={0} onClick={open(r)} onKeyDown={key(r)} aria-label={label(r)}>
        <div className="pastres-head"><span className="pastres-name">#{r.code} • {r.restaurantName}</span><span className="tbadge done">{r.status === 'PAID' ? t('O‘tgan') : t(STATUS_LABEL[r.status])}</span></div>
        <div className="pastres-meta"><span>{whenText(r.startsAt)} • {t('{n} kishi', { n: r.partySize })}</span><span className="mono">{som(r.depositSom)}</span></div>
      </div>
    );
  };

  return (
    <>
    {head}
    <div className="page" style={{ paddingTop: 4 }}>
      {error && <div className="banner warn" role="status">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}
      {list.length === 0 && <Empty icon={<Icon as={CalendarClock} size={44} />} title={t('Hali bron yo‘q')} hint={t('Restoran menyusidagi “Joy bron qilish” tugmasi orqali stol band qiling.')} />}
      {upcoming.length > 0 && <section className="stack" aria-label={t('Kelgusi bronlar')}><h2 className="sec-title">{t('Kelgusi bronlar')}<span className="count">{upcoming.length}</span></h2>{upcoming.map(card)}</section>}
      {past.length > 0 && <section className="stack" aria-label={t('Oldingi bronlar')}><h2 className="sec-title">{t('Oldingi bronlar')}</h2>{past.map(card)}</section>}
    </div>
    </>
  );
}
