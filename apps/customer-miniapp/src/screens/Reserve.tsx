import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, Minus, Plus } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons, StickyAction } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { newKey, som } from '../lib/format';
import { bookingBounds, bookingSummary, checkWhen, dayChoices, dayTile, describeReservationError, localInputToIso, MAX_PARTY, SLOT_TIMES, slotOk, toLocalInput } from '../lib/reservation';
import type { Route } from '../lib/router';
import { haptic } from '../lib/telegram';
import { formatPhone, normalizePhone } from '../lib/validation';
import { useApp, useLoad } from '../state';
import { t } from '../i18n';

/** The first time the form offers: the next full hour at least 90 minutes ahead (the server wants 60). */
const firstSlot = (nowMs: number): string => {
  const base = new Date(nowMs + 90 * 60_000);
  base.setMinutes(0, 0, 0);
  return toLocalInput(new Date(Math.max(base.getTime() + 3_600_000, nowMs + 90 * 60_000)));
};

/** Table reservation form: when, how many, a note. The deposit is paid to the restaurant's card on the next screen. */
export function Reserve({ id, go }: { id: string; go: (r: Route) => void }) {
  const { profile, toast } = useApp();
  const { data, error, loading, reload } = useLoad(signal => api.menu(id, signal), [id]);
  const nowMs = useRef(Date.now()).current;
  const bounds = useMemo(() => bookingBounds(nowMs), [nowMs]);
  const [date, setDate] = useState(() => firstSlot(nowMs).slice(0, 10));
  const [time, setTime] = useState(() => firstSlot(nowMs).slice(11));
  const [party, setParty] = useState(2);
  const [note, setNote] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per distinct form: a second tap on the same form (or a retry after a lost answer) returns the first reservation instead of making another.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  const head = (name?: string) => (
    <header className="screen-head">
      <button type="button" className="round-back" onClick={() => go({ name: 'menu', id })} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>
      <div className="grow"><h1>{t('Joy bron qilish')}</h1>{name && <p className="sub small">{name}</p>}</div>
    </header>
  );
  if (loading && !data) return <>{head()}<div className="page"><Skeletons n={3} /></div></>;
  if (error || !data) return <>{head()}<div className="page"><ErrorBox error={error} onRetry={reload} /></div></>;
  const r = data.restaurant;
  if (!r.reservation) {
    return (
      <>
        {head(r.name)}
        <div className="page" style={{ paddingTop: 4 }}>
          <div className="banner warn">{t('{name} hozir joy bron qilmayapti.', { name: r.name })}</div>
          <Button variant="secondary" onClick={() => go({ name: 'menu', id })}>{t('Menyuga qaytish')}</Button>
        </div>
      </>
    );
  }
  const deposit = r.reservation.depositSom;
  const profilePhone = profile?.phone ?? null;
  const phone = editPhone || !profilePhone ? normalizePhone(phoneInput) : profilePhone;
  const when = `${date}T${time}`;
  const whenError = checkWhen(when, Date.now());
  const days = dayChoices(nowMs);
  const custom = !days.some(d => d.date === date);
  const ready = !whenError && Boolean(phone);

  const submit = async () => {
    setTouched(true);
    setProblem(null);
    const startsAt = localInputToIso(when);
    if (busy || !ready || !startsAt || !phone) return;
    const noteText = note.trim();
    const sig = JSON.stringify([id, startsAt, party, noteText, phone]);
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newKey() };
    setBusy(true);
    try {
      const res = await api.createReservation({
        checkoutKey: keyRef.current.key, restaurantId: id, startsAt, partySize: party,
        ...(noteText ? { note: noteText } : {}),
        ...(phone !== profilePhone ? { phone } : {}),
      });
      haptic.success();
      go({ name: 'reservation', id: res.reservation.id });
    } catch (e) {
      haptic.error();
      const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK');
      setProblem(describeReservationError(err.code, err.status));
      toast(t('Bron yaratilmadi'));
    } finally { setBusy(false); }
  };

  const other = dayTile(date);
  return (
    <>
      {head(r.name)}
      <div className="page resv-page">
        <section className="stack" aria-label={t('Qaysi kuni?')}>
          <h2 className="sec-title">{t('Qaysi kuni?')}</h2>
          <div className="tilegrid" role="radiogroup" aria-label={t('Qaysi kuni?')}>
            {days.map(d => (
              <button key={d.date} type="button" role="radio" aria-checked={date === d.date} className={`daytile ${date === d.date ? 'on' : ''}`} onClick={() => { haptic.tap(); setDate(d.date); }}>
                <span>{d.label}</span><b>{d.num}</b>
              </button>
            ))}
            <label className={`daytile ${custom ? 'on' : ''}`}>
              {custom ? <><span>{other.label}</span><b>{other.num}</b></> : <><span>{t('Boshqa')}</span><Icon as={CalendarDays} size={20} /></>}
              <input className="daytile-input" type="date" min={bounds.min.slice(0, 10)} max={bounds.max.slice(0, 10)} value={date} aria-label={t('Boshqa')}
                onChange={e => { if (e.target.value) setDate(e.target.value); }} />
            </label>
          </div>
        </section>

        <section className="stack" aria-label={t('Soat nechada?')}>
          <h2 className="sec-title">{t('Soat nechada?')}</h2>
          <div className="slotgrid" role="radiogroup" aria-label={t('Soat nechada?')}>
            {SLOT_TIMES.map(slot => (
              <button key={slot} type="button" role="radio" aria-checked={time === slot} disabled={!slotOk(date, slot, nowMs)} className={`slot ${time === slot ? 'on' : ''}`}
                onClick={() => { haptic.tap(); setTime(slot); }}>{slot}</button>
            ))}
          </div>
          {touched && whenError && <div className="err">{whenError}</div>}
        </section>

        <section className="partyrow" aria-label={t('Necha kishi?')}>
          <h2 className="sec-title">{t('Necha kishi?')}</h2>
          <div className="stepper" role="group" aria-label={t('Necha kishi?')}>
            <button type="button" aria-label={t('Kamaytirish')} disabled={party <= 1} onClick={() => { haptic.tap(); setParty(p => Math.max(1, p - 1)); }}><Icon as={Minus} size={22} /></button>
            <span className="mono" aria-live="polite">{party}</span>
            <button type="button" aria-label={t('Ko‘paytirish')} disabled={party >= MAX_PARTY} onClick={() => { haptic.tap(); setParty(p => Math.min(MAX_PARTY, p + 1)); }}><Icon as={Plus} size={22} /></button>
          </div>
        </section>

        <div className="field">
          <label htmlFor="resv-note" className="fieldlbl">{t('Izoh (ixtiyoriy)')}</label>
          <textarea id="resv-note" className="input" rows={2} maxLength={200} placeholder={t('Masalan: tug‘ilgan kun, bolalar stuli kerak')} value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {profilePhone && !editPhone ? (
          <div className="row between"><span className="sub">{t('Telefon:')} <span className="bold mono">{formatPhone(profilePhone)}</span></span><Button small variant="ghost" onClick={() => setEditPhone(true)}>{t('O‘zgartirish')}</Button></div>
        ) : (
          <div className="field">
            <label htmlFor="resv-phone" className="fieldlbl">{t('Telefon raqamingiz')}</label>
            <input id="resv-phone" className={`input ${touched && !phone ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} />
            {touched && !phone && <div className="err">{t('Telefon raqamini to‘g‘ri kiriting (masalan, 90 123 45 67)')}</div>}
          </div>
        )}

        <section className="depositcard" aria-label={t('Bron uchun oldindan to‘lov')}>
          <div className="row between"><span className="bold">{t('Bron uchun oldindan to‘lov')}</span><span className="depositcard-sum mono">{som(deposit)}</span></div>
          <p>{t('Pul restoranning kartasiga o‘tkaziladi va joy sizga band qilinadi. To‘lov tushgach, restoran darrov xabar oladi. Muammo bo‘lsa, restoran xodimi siz bilan bog‘lanib, pulni qaytaradi.')}</p>
        </section>

        {problem && <div className="banner bad" role="alert">{problem}</div>}
        <StickyAction hint={time ? bookingSummary(date, time, party, nowMs) : t('Soatni tanlang')}>
          <Button loading={busy} onClick={() => void submit()}><span className="btn-split"><span>{t('To‘lashga o‘tish')}</span><span className="mono">{som(deposit)}</span></span></Button>
        </StickyAction>
      </div>
    </>
  );
}
