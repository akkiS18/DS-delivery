import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, MapPin, ShoppingBasket } from 'lucide-react';
import { Button, Empty, Icon, Spinner } from '../components/ui';
import { api, ApiError, type CheckoutBody } from '../lib/api';
import { cartCount, cartTotal } from '../lib/cart';
import { describeCheckoutError, type Described } from '../lib/checkoutErrors';
import { newKey, som } from '../lib/format';
import type { Route } from '../lib/router';
import { haptic } from '../lib/telegram';
import { checkoutReady, formatPhone, hasErrors, normalizePhone, validateAddress } from '../lib/validation';
import { useApp } from '../state';

const KEY_STORAGE = 'ds.checkoutKey.v1';
/** One idempotency key per cart content: a double tap, a retry after a lost response or a reload re-uses it and can never create a second order. */
const keyFor = (signature: string): string => {
  try {
    const raw = window.sessionStorage.getItem(KEY_STORAGE);
    const saved = raw ? JSON.parse(raw) as { signature: string; key: string } : null;
    if (saved && saved.signature === signature) return saved.key;
    const key = newKey();
    window.sessionStorage.setItem(KEY_STORAGE, JSON.stringify({ signature, key }));
    return key;
  } catch { return newKey(); }
};
const forgetKey = () => { try { window.sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ } };

export function Checkout({ go }: { go: (r: Route, o?: { replace?: boolean }) => void }) {
  const { cart, dispatch, profile, refreshProfile, toast } = useApp();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [label, setLabel] = useState('Uy');
  const [text, setText] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [save, setSave] = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Described | null>(null);
  const busy = useRef(false);

  const addresses = profile?.addresses ?? [];
  useEffect(() => {
    if (selected !== null || !profile) return;
    setSelected(profile.defaultAddressId ?? profile.lastUsedAddressId ?? addresses[0]?.id ?? 'new');
  }, [profile, selected, addresses]);

  const signature = useMemo(() => `${cart.restaurantId}|${cart.lines.map(l => `${l.productId}:${l.quantity}`).join(',')}`, [cart]);

  if (cart.lines.length === 0) return <div className="page"><Empty icon={<Icon as={ShoppingBasket} size={44} />} title="Savat bo‘sh" action={<Button onClick={() => go({ name: 'home' })}>Restoranlar</Button>} /></div>;
  if (!profile) return <div className="page"><Spinner /></div>;

  const savedAddress = addresses.find(a => a.id === selected) ?? null;
  const newErrors = selected === 'new' ? validateAddress({ label, addressText: text, lat: coords?.lat ?? null, lng: coords?.lng ?? null }) : {};
  const phone = editPhone || !profile.phone ? normalizePhone(phoneInput) : profile.phone;
  const ready = checkoutReady({ addressText: selected === 'new' ? text : savedAddress?.addressText ?? null, phone });
  const canSubmit = ready.ok && !hasErrors(newErrors) && !submitting;
  const total = cartTotal(cart);

  const locate = () => {
    if (!navigator.geolocation) { toast('Joylashuvni aniqlab bo‘lmadi'); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setCoords({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); toast('Joylashuv qo‘shildi'); },
      () => toast('Joylashuvga ruxsat berilmadi'), { timeout: 8000, maximumAge: 60_000 });
  };

  const submit = async () => {
    setTouched(true);
    if (!canSubmit || busy.current) return;   // a ref, not just state: two taps in the same frame still send one request
    busy.current = true; setSubmitting(true); setProblem(null);
    const body: CheckoutBody = {
      checkoutKey: keyFor(signature),
      restaurantId: cart.restaurantId!,
      items: cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })),
      expectedTotalSom: total,
      expectedUnitPrices: Object.fromEntries(cart.lines.map(l => [l.productId, l.priceSom])),
      ...(selected === 'new'
        ? { address: { label: label.trim(), addressText: text.trim(), ...(coords ?? {}), save } }
        : { addressId: selected! }),
      ...(phone && phone !== profile.phone ? { phone } : {}),
    };
    try {
      const { order } = await api.createOrder(body);
      forgetKey(); haptic.success();
      dispatch({ type: 'clear' });
      void refreshProfile();
      go({ name: 'order', id: order.id }, { replace: true });
    } catch (e) {
      haptic.error();
      const d = describeCheckoutError(e);
      if (d.kind === 'PRICE' && d.currentLines) dispatch({ type: 'reprice', lines: d.currentLines.map(l => ({ productId: l.productId, unitSom: l.unitSom })) });
      if (d.kind === 'UNAVAILABLE' && d.unavailableIds?.length) dispatch({ type: 'drop', productIds: d.unavailableIds });
      setProblem(d);
      if (!(e instanceof ApiError) || e.code === 'NARX_OZGARGAN') { /* the key is kept: nothing was created */ }
    } finally { busy.current = false; setSubmitting(false); }
  };

  return (
    <div className="page">
      <h1 className="page-title">Buyurtmani rasmiylashtirish</h1>

      <section className="stack" aria-label="Yetkazish manzili">
        <h2 style={{ fontSize: 17 }}>1. Yetkazish manzili</h2>
        {addresses.map(a => (
          <label key={a.id} className="card row" style={{ border: selected === a.id ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
            <input type="radio" name="addr" checked={selected === a.id} onChange={() => setSelected(a.id)} style={{ width: 22, height: 22 }} />
            <div className="grow">
              <div className="bold">{a.label}{a.isDefault && <span className="badge" style={{ marginLeft: 8 }}>Asosiy</span>}</div>
              <div className="sub small">{a.addressText}</div>
            </div>
          </label>
        ))}
        <label className="card row" style={{ border: selected === 'new' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
          <input type="radio" name="addr" checked={selected === 'new'} onChange={() => setSelected('new')} style={{ width: 22, height: 22 }} />
          <span className="bold">+ Yangi manzil</span>
        </label>
        {selected === 'new' && (
          <div className="card stack">
            <div className="field"><label htmlFor="lbl">Nomi</label>
              <input id="lbl" className={`input ${touched && newErrors.label ? 'invalid' : ''}`} value={label} maxLength={30} onChange={e => setLabel(e.target.value)} placeholder="Uy, Ish..." />
              {touched && newErrors.label && <div className="err">{newErrors.label}</div>}</div>
            <div className="field"><label htmlFor="adr">Manzil</label>
              <textarea id="adr" className={`input ${touched && newErrors.addressText ? 'invalid' : ''}`} rows={3} value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder="Ko‘cha, uy, kvartira, mo‘ljal" />
              {touched && newErrors.addressText && <div className="err">{newErrors.addressText}</div>}</div>
            <Button variant="secondary" onClick={locate}><Icon as={coords ? CircleCheck : MapPin} />{coords ? 'Joylashuv qo‘shildi' : 'Joylashuvni qo‘shish (ixtiyoriy)'}</Button>
            <label className="row"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} style={{ width: 22, height: 22 }} /> Keyingi buyurtmalar uchun saqlash</label>
          </div>
        )}
      </section>

      <section className="stack" aria-label="Telefon">
        <h2 style={{ fontSize: 17 }}>2. Telefon raqami</h2>
        {profile.phone && !editPhone ? (
          <div className="card row between"><span className="bold mono">{formatPhone(profile.phone)}</span><Button small variant="ghost" onClick={() => setEditPhone(true)}>O‘zgartirish</Button></div>
        ) : (
          <div className="field">
            <input className={`input ${touched && !phone ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} aria-label="Telefon raqami" />
            {touched && !phone && <div className="err">Telefon raqamini to‘g‘ri kiriting (masalan, 90 123 45 67)</div>}
            <p className="sub small" style={{ marginTop: 6 }}>Keyingi buyurtmalarda qayta so‘ralmaydi.</p>
          </div>
        )}
      </section>

      <section className="card stack" aria-label="Buyurtma xulosasi">
        <h2 style={{ fontSize: 17 }}>3. Buyurtma</h2>
        <div className="sub small">{cart.restaurantName} • {cartCount(cart)} ta</div>
        {cart.lines.map(l => <div key={l.productId} className="row between small"><span className="grow">{l.quantity} × {l.name}</span><span className="mono">{som(l.priceSom * l.quantity)}</span></div>)}
        <div className="divider" />
        <div className="row between"><span className="bold">Taomlar jami</span><span className="bold mono">{som(total)}</span></div>
        <div className="row between sub small"><span>Yetkazish (taksi)</span><span>alohida, taksi tarifi bo‘yicha</span></div>
        <p className="sub small">Taom uchun to‘lov to‘g‘ridan-to‘g‘ri restoranga. Keyingi qadam — to‘lov.</p>
      </section>

      {problem && (
        <div className={`banner ${problem.kind === 'PRICE' ? 'warn' : 'bad'}`} role="alert">
          {problem.message}
          {problem.kind === 'PRICE' && <div style={{ marginTop: 8 }}><strong>Yangi summani tasdiqlash uchun tugmani qayta bosing.</strong></div>}
          {problem.kind === 'UNAVAILABLE' && <div style={{ marginTop: 8 }}><Button small variant="secondary" onClick={() => go({ name: 'cart' })}>Savatga qaytish</Button></div>}
        </div>
      )}

      <Button loading={submitting} disabled={!canSubmit && touched ? true : false} onClick={() => void submit()}>
        {problem?.kind === 'PRICE' ? `Yangi narxda to‘lovga o‘tish • ${som(total)}` : `To‘lovga o‘tish • ${som(total)}`}
      </Button>
      {!ready.ok && touched && <p className="err center">{ready.missing.includes('address') ? 'Manzilni tanlang yoki kiriting. ' : ''}{ready.missing.includes('phone') ? 'Telefon raqamini kiriting.' : ''}</p>}
    </div>
  );
}
