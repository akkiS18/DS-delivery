import { useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons, StickyAction } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { newKey, som } from '../lib/format';
import { bookingBounds, checkWhen, describeReservationError, localInputToIso, MAX_PARTY, toLocalInput } from '../lib/reservation';
import type { Route } from '../lib/router';
import { haptic } from '../lib/telegram';
import { formatPhone, normalizePhone } from '../lib/validation';
import { useApp, useLoad } from '../state';

/** The first time the form offers: the next full hour at least 90 minutes ahead (the server wants 60). */
const firstSlot = (nowMs: number): string => {
  const t = new Date(nowMs + 90 * 60_000);
  t.setMinutes(0, 0, 0);
  return toLocalInput(new Date(Math.max(t.getTime() + 3_600_000, nowMs + 90 * 60_000)));
};

/** Table reservation form: when, how many, a note. The deposit is paid to the restaurant's card on the next screen. */
export function Reserve({ id, go }: { id: string; go: (r: Route) => void }) {
  const { profile, toast } = useApp();
  const { data, error, loading, reload } = useLoad(signal => api.menu(id, signal), [id]);
  const nowMs = useRef(Date.now()).current;
  const bounds = useMemo(() => bookingBounds(nowMs), [nowMs]);
  const [when, setWhen] = useState(() => firstSlot(nowMs));
  const [party, setParty] = useState(2);
  const [note, setNote] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per distinct form: a second tap on the same form (or a retry after a lost answer) returns the first reservation instead of making another.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  if (loading && !data) return <div className="page"><Skeletons n={3} /></div>;
  if (error || !data) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;
  const r = data.restaurant;
  if (!r.reservation) {
    return (
      <div className="page">
        <h1 className="page-title">Joy bron qilish</h1>
        <div className="banner warn">{r.name} hozir joy bron qilmayapti.</div>
        <Button variant="secondary" onClick={() => go({ name: 'menu', id })}>Menyuga qaytish</Button>
      </div>
    );
  }
  const deposit = r.reservation.depositSom;
  const profilePhone = profile?.phone ?? null;
  const phone = editPhone || !profilePhone ? normalizePhone(phoneInput) : profilePhone;
  const whenError = checkWhen(when, Date.now());
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
      toast('Bron yaratilmadi');
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div>
        <h1 className="page-title">Joy bron qilish</h1>
        <p className="sub">{r.name}</p>
      </div>

      <div className="card stack">
        <div className="field">
          <label htmlFor="resv-when">Sana va vaqt</label>
          <input id="resv-when" className={`input ${touched && whenError ? 'invalid' : ''}`} type="datetime-local" step={900} min={bounds.min} max={bounds.max} value={when} onChange={e => setWhen(e.target.value)} />
          {touched && whenError && <div className="err">{whenError}</div>}
        </div>
        <div className="field">
          <label>Necha kishi</label>
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="chip" aria-label="Kamaytirish" disabled={party <= 1} onClick={() => { haptic.tap(); setParty(p => Math.max(1, p - 1)); }}><Icon as={Minus} size={20} /></button>
            <span className="bold mono" style={{ fontSize: 22, minWidth: 32, textAlign: 'center' }} aria-live="polite">{party}</span>
            <button type="button" className="chip" aria-label="Ko‘paytirish" disabled={party >= MAX_PARTY} onClick={() => { haptic.tap(); setParty(p => Math.min(MAX_PARTY, p + 1)); }}><Icon as={Plus} size={20} /></button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="resv-note">Izoh (ixtiyoriy)</label>
          <textarea id="resv-note" className="input" rows={2} maxLength={200} placeholder="Masalan: tug‘ilgan kun, bolalar stuli kerak" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        {profilePhone && !editPhone ? (
          <div className="row between"><span className="sub">Telefon: <span className="bold mono">{formatPhone(profilePhone)}</span></span><Button small variant="ghost" onClick={() => setEditPhone(true)}>O‘zgartirish</Button></div>
        ) : (
          <div className="field">
            <label htmlFor="resv-phone">Telefon raqamingiz</label>
            <input id="resv-phone" className={`input ${touched && !phone ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} />
            {touched && !phone && <div className="err">Telefon raqamini to‘g‘ri kiriting (masalan, 90 123 45 67)</div>}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row between"><span>Bron uchun oldindan to‘lov</span><span className="bold mono" style={{ fontSize: 20 }}>{som(deposit)}</span></div>
        <p className="sub small">Pul restoranning kartasiga o‘tkaziladi va joy sizga band qilinadi. To‘lov tushgach, restoran darrov xabar oladi. Muammo bo‘lsa, restoran xodimi siz bilan bog‘lanib, pulni qaytaradi.</p>
      </div>

      {problem && <div className="banner bad" role="alert">{problem}</div>}
      <Button variant="ghost" onClick={() => go({ name: 'menu', id })}>Orqaga</Button>
      <StickyAction hint="Keyingi ekranda restoran kartasiga o‘tkazma qilasiz">
        <Button loading={busy} onClick={() => void submit()}>To‘lashga o‘tish • {som(deposit)}</Button>
      </StickyAction>
    </div>
  );
}
