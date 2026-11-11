import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronLeft, Users } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons } from '../components/ui';
import { PayCard } from '../components/PayCard';
import { PayWarning } from '../components/PayWarning';
import { ReservationTicket } from '../components/ReservationTicket';
import { api, ApiError } from '../lib/api';
import { som } from '../lib/format';
import { anchorOf, paymentRemainingSeconds, windowMinutes, type Anchor } from '../lib/order';
import { STATUS_LABEL, whenText } from '../lib/reservation';
import type { Route } from '../lib/router';
import type { ReservationView } from '../lib/types';
import { useApp, useNow } from '../state';
import { t } from '../i18n';

const POLL_MS = 4000;

/** One reservation: the card to pay the deposit to while unpaid, then the confirmation ("joy band qilindi"). */
export function ReservationScreen({ id, go }: { id: string; go: (r: Route) => void }) {
  const { toast } = useApp();
  const [r, setR] = useState<ReservationView | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const v = (await api.reservation(id, signal)).reservation;
      setR(v); setAnchor(anchorOf(v.serverNow, performance.now())); setError(null);
    } catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, [id]);

  useEffect(() => { const ac = new AbortController(); void refresh(ac.signal); return () => ac.abort(); }, [refresh]);

  // Polled only while the payment is open; paused while the app is in the background.
  const status = r?.status;
  useEffect(() => {
    if (status !== 'PENDING_PAYMENT') return;
    let timer: number | undefined;
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const start = () => { stop(); timer = window.setInterval(() => void refresh(), POLL_MS); };
    const vis = () => { if (document.hidden) stop(); else { void refresh(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [status, refresh]);

  const ins = r?.payment.instructions ?? null;
  const counting = status === 'PENDING_PAYMENT' && Boolean(ins?.expiresAt);
  const perfNow = useNow(1000, counting);

  if (!r && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!r) return <div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div>;

  const pay = r.payment;
  const left = counting && anchor ? paymentRemainingSeconds(ins?.expiresAt, anchor, perfNow) : null;
  const phone = r.restaurantPhone ? r.restaurantPhone.replace(/[^\d+]/g, '') : '';
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text.replace(/\D/g, '')); toast(t('Nusxalandi')); } catch { toast(t('Nusxalab bo‘lmadi')); }
  };

  return (
    <>
    <header className="screen-head">
      <button type="button" className="round-back" onClick={() => go({ name: 'reservations' })} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>
      <div className="grow">
        <h1>{t('Bron #{code}', { code: r.code })}</h1>
        <p className="sub">{r.restaurantName}</p>
      </div>
      {r.isTest && <span className="badge test">TEST</span>}
    </header>
    <div className="page" style={{ paddingTop: 4 }}>
      {r.status === 'PAID' && <ReservationTicket r={r} id="cottonTktDetail" />}
      {r.status === 'PAID' && <div className="banner" role="status">{t('To‘lov qabul qilindi — joy siz uchun band. Restoran xabar oldi.')}</div>}

      {r.status !== 'PAID' && <div className="card stack">
        <div className="status-line"><Icon as={CalendarClock} /><span className="bold">{t(STATUS_LABEL[r.status])}</span></div>
        <div className="row between small"><span className="row" style={{ gap: 6 }}><Icon as={CalendarClock} size={16} />{whenText(r.startsAt)}</span><span className="row" style={{ gap: 6 }}><Icon as={Users} size={16} />{t('{n} kishi', { n: r.partySize })}</span></div>
        {r.note && <p className="sub small">{r.note}</p>}
        {r.status === 'EXPIRED' && <div className="banner bad">{t('To‘lov muddati tugadi, bron bekor bo‘ldi. Pul o‘tkazgan bo‘lsangiz, restoranga murojaat qiling')}{phone ? <>: <a href={`tel:${phone}`} className="nowrap">{r.restaurantPhone}</a></> : '.'}</div>}
        {r.status === 'CANCELLED' && <div className="banner warn">{t('Restoran bronni bekor qildi. To‘lov qilgan bo‘lsangiz, xodim siz bilan bog‘lanib pulni qaytaradi')}{phone ? <>. {t('Savol:')} <a href={`tel:${phone}`} className="nowrap">{r.restaurantPhone}</a></> : '.'}</div>}
      </div>}

      {r.status === 'PENDING_PAYMENT' && (
        <div className="card stack" aria-label={t('To‘lov')}>
          <h2 style={{ fontSize: 17 }}>{t('Oldindan to‘lov')}</h2>
          <div className="row between"><span>{t('To‘lov summasi')}</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.amountSom)}</span></div>
          {pay.queued && <div className="banner warn">{t('To‘lov rekvizitlari hozir band. Birozdan keyin avtomatik ko‘rinadi.')}</div>}
          {pay.checking && <div className="banner" role="status">{t('To‘lov tushganini tekshiryapmiz. Sahifada qoling.')}</div>}
          {ins && pay.mode === 'REAL' && (
            ins.recipientUnavailable || !ins.cardNumber
              ? <div className="banner bad" role="alert"><strong>{t('To‘lov qabul qiluvchi hozircha sozlanmagan.')}</strong><br />{t('Hozir pul o‘tkazmang. Restoran bilan bog‘laning yoki keyinroq qaytib keling.')}</div>
              : (
                <div className="stack">
                  <PayWarning amountSom={pay.amountSom} windowMinutes={windowMinutes(ins.windowSeconds)} remaining={left} total={ins.windowSeconds ?? null} contactPhone={r.restaurantPhone} />
                  <PayCard number={ins.cardNumber} holder={ins.cardHolder ?? r.restaurantName} onCopy={d => void copy(d)} />
                </div>
              )
          )}
          {pay.mode === 'MOCK' && <div className="banner">{t('Sinov rejimi: haqiqiy pul olinmaydi, to‘lov o‘zi tasdiqlanadi.')}</div>}
          <p className="sub small">{t('O‘tkazgandan so‘ng bu sahifada qoling — holat o‘zi yangilanadi.')}</p>
        </div>
      )}

      {error && <div className="banner warn">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}
      {(r.status === 'EXPIRED' || r.status === 'CANCELLED') && <Button onClick={() => go({ name: 'home' })}>{t('Restoranlar')}</Button>}
    </div>
    </>
  );
}
