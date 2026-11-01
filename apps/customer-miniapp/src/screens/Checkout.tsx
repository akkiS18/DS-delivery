import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, MapPin, ShoppingBasket } from 'lucide-react';
import { DeliveryNotice } from '../components/DeliveryNotice';
import { PlatformLine, TaxiFareBox } from '../components/PriceLines';
import { Button, ChoiceSummary, Empty, Icon, Spinner, StickyAction } from '../components/ui';
import { api, ApiError, type CheckoutBody } from '../lib/api';
import { cartCount, cartView } from '../lib/cart';
import { describeCheckoutError, type Described } from '../lib/checkoutErrors';
import { newKey, som } from '../lib/format';
import { effectiveMethod, methodChoices } from '../lib/payMethod';
import { loadTaxiChoice, pickTaxi, saveTaxiChoice } from '../lib/taxi';
import type { PaymentMethod, PaymentOptions, TaxiOption } from '../lib/types';
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
  const [walk, setWalk] = useState(false);
  // Walking is offered only by a restaurant that allows it (the server says so in the quote); everywhere else the option is not shown.
  const [walkingAvailable, setWalkingAvailable] = useState(false);
  // Chosen options are shown as one line each; the full list opens only when the customer taps "O‘zgartirish".
  const [addrOpen, setAddrOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Described | null>(null);
  const busy = useRef(false);
  // The taxi services that can be booked now (null = still loading). With several of them the customer chooses; the delivery price is theirs.
  const [taxiOptions, setTaxiOptions] = useState<TaxiOption[] | null>(null);
  const [taxiId, setTaxiId] = useState<string | null>(null);
  const [taxiFailed, setTaxiFailed] = useState(false);
  // What the server says the customer may choose for the food payment (null = unknown: card only). `chosen` is the customer's own tap, if any.
  const [payOptions, setPayOptions] = useState<PaymentOptions | null>(null);
  const [chosen, setChosen] = useState<PaymentMethod | null>(null);

  const loadTaxis = useCallback(() => {
    setTaxiFailed(false);
    api.taxiCompanies().then(r => { setTaxiOptions(r.companies); setTaxiId(cur => pickTaxi(r.companies, cur, loadTaxiChoice())); }, () => setTaxiFailed(true));
  }, []);
  useEffect(() => { loadTaxis(); }, [loadTaxis]);

  const addresses = profile?.addresses ?? [];
  useEffect(() => {
    if (selected !== null || !profile) return;
    setSelected(profile.defaultAddressId ?? profile.lastUsedAddressId ?? addresses[0]?.id ?? 'new');
  }, [profile, selected, addresses]);

  const itemsKey = useMemo(() => cart.lines.map(l => `${l.productId}:${l.quantity}`).join(','), [cart.lines]);
  useEffect(() => {
    if (!cart.restaurantId || cart.lines.length === 0) return;
    const ac = new AbortController();
    api.quote(cart.restaurantId, cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })), ac.signal)
      .then(q => {
        setPayOptions(q.ok ? q.paymentOptions ?? null : null);
        const can = q.ok && q.walkingAvailable === true;
        setWalkingAvailable(can);
        if (!can) setWalk(false);
      }, () => { /* no advice: card only, no walking */ });
    return () => ac.abort();
  }, [cart.restaurantId, itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const method = effectiveMethod(chosen, payOptions);
  const choices = methodChoices(payOptions);

  const signature = useMemo(() => `${cart.restaurantId}|${itemsKey}|${taxiId ?? ''}|${method}|${walk ? 'walk' : ''}`, [cart.restaurantId, itemsKey, taxiId, method, walk]);

  if (cart.lines.length === 0) return <div className="page"><Empty icon={<Icon as={ShoppingBasket} size={44} />} title="Savat bo‘sh" action={<Button onClick={() => go({ name: 'home' })}>Restoranlar</Button>} /></div>;
  if (!profile) return <div className="page"><Spinner /></div>;

  const savedAddress = addresses.find(a => a.id === selected) ?? null;
  const newErrors = selected === 'new' ? validateAddress({ label, addressText: text, lat: coords?.lat ?? null, lng: coords?.lng ?? null }) : {};
  const phone = editPhone || !profile.phone ? normalizePhone(phoneInput) : profile.phone;
  const ready = checkoutReady({ addressText: selected === 'new' ? text : savedAddress?.addressText ?? null, phone });
  // Several services and none picked yet: the customer must choose. No services at all (or the list failed): the server answers with the reason.
  const taxiMissing = taxiOptions !== null && taxiOptions.length > 1 && taxiId === null;
  const canSubmit = ready.ok && !hasErrors(newErrors) && !submitting && taxiOptions !== null && !taxiMissing;
  const view = cartView(cart);
  const total = view.totalSom;

  // Chosen options collapse into one line each; they open when the customer changes them or when something there still needs an answer.
  const addrExpanded = addrOpen || selected === 'new' || addresses.length === 0;
  const deliveryExpanded = deliveryOpen || taxiOptions === null || taxiFailed || taxiOptions.length === 0 || taxiMissing;
  const missingText = [
    ready.missing.includes('address') || (selected === 'new' && hasErrors(newErrors)) ? 'Manzilni kiriting' : '',
    ready.missing.includes('phone') ? 'Telefon raqamini kiriting' : '',
    taxiMissing ? 'Taksi xizmatini tanlang' : '',
  ].filter(Boolean).join(' • ');
  const stickyHint = touched && !canSubmit && taxiOptions !== null && missingText
    ? missingText
    : method === 'CASH' ? 'Restoran tasdiqlagach taom tayyorlanadi, pulni haydovchiga berasiz' : 'Keyingi ekranda restoran kartasiga o‘tkazma qilasiz';

  const locate = () => {
    if (!navigator.geolocation) { toast('Joylashuvni aniqlab bo‘lmadi'); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setCoords({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); toast('Joylashuv qo‘shildi'); },
      () => toast('Joylashuvga ruxsat berilmadi'), { timeout: 8000, maximumAge: 60_000 });
  };

  const submit = async () => {
    setTouched(true);
    if (busy.current) return;   // a ref, not just state: two taps in the same frame still send one request
    if (!canSubmit) {
      // Not silently disabled: say what is missing and take the customer to it.
      const target = (selected === 'new' && hasErrors(newErrors)) || ready.missing.includes('address') ? 'co-address' : ready.missing.includes('phone') ? 'co-phone' : taxiMissing ? 'co-delivery' : null;
      if (target === 'co-address') setAddrOpen(true);
      if (target === 'co-delivery') setDeliveryOpen(true);
      if (target) window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    busy.current = true; setSubmitting(true); setProblem(null);
    const body: CheckoutBody = {
      checkoutKey: keyFor(signature),
      restaurantId: cart.restaurantId!,
      items: cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })),
      expectedTotalSom: total,
      expectedUnitPrices: Object.fromEntries(view.lines.map(l => [l.productId, l.unitSom])),
      ...(selected === 'new'
        ? { address: { label: label.trim(), addressText: text.trim(), ...(coords ?? {}), save } }
        : { addressId: selected! }),
      ...(phone && phone !== profile.phone ? { phone } : {}),
      ...(taxiId ? { taxiCompanyId: taxiId } : {}),
      ...(method === 'CASH' ? { paymentMethod: 'CASH' as const } : {}),
      ...(walk ? { deliveryPreference: 'WALK_OK' as const } : {}),
    };
    try {
      const { order } = await api.createOrder(body);
      if (taxiId) saveTaxiChoice(taxiId);
      forgetKey(); haptic.success();
      dispatch({ type: 'clear' });
      void refreshProfile();
      go({ name: 'order', id: order.id }, { replace: true });
    } catch (e) {
      haptic.error();
      const d = describeCheckoutError(e);
      if (d.kind === 'PRICE' && d.pricing) dispatch({ type: 'pricing', pricing: d.pricing });
      if (d.kind === 'PRICE' && d.currentLines) dispatch({ type: 'reprice', lines: d.currentLines.filter(l => !l.free && !l.packaging).map(l => ({ productId: l.productId, unitSom: l.baseUnitSom ?? l.unitSom })) });
      if (d.kind === 'UNAVAILABLE' && d.unavailableIds?.length) dispatch({ type: 'drop', productIds: d.unavailableIds });
      if (d.kind === 'NO_TAXI') { setTaxiId(null); loadTaxis(); } // the chosen service went away: show the current list
      setProblem(d);
      if (!(e instanceof ApiError) || e.code === 'NARX_OZGARGAN') { /* the key is kept: nothing was created */ }
    } finally { busy.current = false; setSubmitting(false); }
  };

  return (
    <div className="page">
      <h1 className="page-title">Buyurtmani rasmiylashtirish</h1>

      <section className="stack" id="co-address" aria-label="Yetkazish manzili">
        <h2 style={{ fontSize: 17 }}>Yetkazish manzili</h2>
        {!addrExpanded && savedAddress ? (
          <ChoiceSummary title="Manzil" value={savedAddress.label} sub={savedAddress.addressText} onChange={() => setAddrOpen(true)} />
        ) : (<>
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
        </>)}
      </section>

      <section className="stack" id="co-phone" aria-label="Telefon">
        <h2 style={{ fontSize: 17 }}>Telefon raqami</h2>
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

      <section className="stack" id="co-delivery" aria-label="Yetkazish usuli">
        <h2 style={{ fontSize: 17 }}>Yetkazish usuli</h2>
        {!deliveryExpanded ? (
          <ChoiceSummary
            title="Yetkazish"
            value={walk && walkingAvailable ? 'Piyoda (restoran hal qiladi)' : 'Taksi bilan'}
            sub={`${walk ? 'Zaxira: ' : ''}${taxiOptions?.find(t => t.id === taxiId)?.name ?? 'taksi xizmati'} • narxni taksi xizmati belgilaydi`}
            onChange={() => setDeliveryOpen(true)} />
        ) : (<>
        <label className="card row" style={{ border: !walk ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
          <input type="radio" name="deliverymode" checked={!walk} onChange={() => setWalk(false)} style={{ width: 22, height: 22 }} />
          <div className="grow">
            <div className="bold">Taksi xizmatidan foydalanaman</div>
            <div className="sub small">Taksi buyurtmani manzilingizgacha olib boradi</div>
          </div>
        </label>
        {walkingAvailable && (
        <label className="card row" style={{ border: walk ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
          <input type="radio" name="deliverymode" checked={walk} onChange={() => setWalk(true)} style={{ width: 22, height: 22 }} />
          <div className="grow">
            <div className="bold">Uyim yaqin — piyoda olib borsa bo‘ladi</div>
            <div className="sub small">Yakuniy qarorni restoran qiladi. Rozi bo‘lsa, taksi chaqirilmaydi va yetkazish uchun haq to‘lamaysiz. Rozi bo‘lmasa, taksi chaqiriladi.</div>
          </div>
        </label>
        )}
        <h3 style={{ fontSize: 15 }}>{walk ? 'Zaxira taksi xizmati' : 'Yetkazib beruvchi taksi'}</h3>
        {taxiOptions === null && !taxiFailed && <Spinner />}
        {taxiFailed && <div className="banner warn" role="alert">Taksi xizmatlari ro‘yxatini yuklab bo‘lmadi. <Button small variant="secondary" onClick={loadTaxis}>Qayta urinish</Button></div>}
        {taxiOptions !== null && taxiOptions.length === 0 && <div className="banner warn" role="alert">Hozir yetkazib berish uchun taksi xizmati mavjud emas. Birozdan keyin urinib ko‘ring.</div>}
        {taxiOptions !== null && taxiOptions.map(t => (
          <label key={t.id} className="card row" style={{ border: taxiId === t.id ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
            <input type="radio" name="taxi" checked={taxiId === t.id} onChange={() => setTaxiId(t.id)} style={{ width: 22, height: 22 }} />
            <div className="grow">
              <div className="bold">{t.name}</div>
              <div className="sub small">Yetkazish haqini taksi xizmati o‘zi belgilaydi</div>
            </div>
          </label>
        ))}
        {touched && taxiMissing && <div className="err">Taksi xizmatini tanlang.</div>}
        </>)}
      </section>

      {choices.cash && (
        <section className="stack" aria-label="To‘lov usuli">
          <h2 style={{ fontSize: 17 }}>Taom uchun to‘lov</h2>
          {!payOpen ? (
            <ChoiceSummary title="To‘lov usuli" value={method === 'CASH' ? 'Naqd pul' : 'Kartaga o‘tkazma'} sub={method === 'CASH' ? 'Taom narxini haydovchiga berasiz' : 'Buyurtmadan keyin restoran kartasiga o‘tkazasiz'} onChange={() => setPayOpen(true)} />
          ) : (<>
          {choices.card && (
            <label className="card row" style={{ border: method === 'CARD' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
              <input type="radio" name="paymethod" checked={method === 'CARD'} onChange={() => setChosen('CARD')} style={{ width: 22, height: 22 }} />
              <div className="grow">
                <div className="bold">Kartaga o‘tkazma</div>
                <div className="sub small">{choices.cardBusy ? 'To‘lov rekvizitlari hozir band — navbat kutishingiz mumkin' : 'Rekvizit ko‘rsatiladi; o‘tkazganingizdan so‘ng taom tayyorlanadi'}</div>
              </div>
            </label>
          )}
          <label className="card row" style={{ border: method === 'CASH' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
            <input type="radio" name="paymethod" checked={method === 'CASH'} onChange={() => setChosen('CASH')} style={{ width: 22, height: 22 }} />
            <div className="grow">
              <div className="bold">Naqd pul</div>
              <div className="sub small">Taom narxini yetkazib berilganda haydovchiga berasiz (yetkazish haqi alohida). Restoran buyurtmani tasdiqlaydi.</div>
            </div>
          </label>
          </>)}
        </section>
      )}

      <section className="card stack" aria-label="Buyurtma xulosasi">
        <h2 style={{ fontSize: 17 }}>Buyurtma</h2>
        <div className="sub small">{cart.restaurantName} • {cartCount(cart)} ta</div>
        {view.lines.map(l => <div key={l.productId} className="row between small"><span className="grow">{l.quantity} × {l.name}{l.freeQty > 0 ? ` (${l.freeQty} ta bepul)` : ''}</span><span className="mono">{som(l.subtotalSom)}</span></div>)}
        {view.extras.map(x => <div key={x.productId} className="row between small"><span className="grow">{x.quantity} × {x.name}</span><span className="mono">{som(x.subtotalSom)}</span></div>)}
        {view.promoSavedSom > 0 && <div className="row between small saved"><span>Aksiya (1+1)</span><span className="mono">−{som(view.promoSavedSom)}</span></div>}
        <div className="divider" />
        <div className="row between"><span className="bold">Taomlar</span><span className="bold mono">{som(view.dishesSom)}</span></div>
        <PlatformLine pricing={view.pricing} />
        {view.pricing.mode === 'LINE' && <div className="row between"><span className="bold">Jami (taksidan tashqari)</span><span className="bold mono">{som(total)}</span></div>}
        <TaxiFareBox walk={walk && walkingAvailable} taxiName={taxiOptions?.find(t => t.id === taxiId)?.name ?? null} />
        <DeliveryNotice />
        <p className="sub small">{method === 'CASH' ? 'Naqd to‘lov: restoran tasdiqlagach taom tayyorlanadi, pulni yetkazib berganda haydovchiga berasiz.' : 'Taom uchun to‘lov to‘g‘ridan-to‘g‘ri restoranga. Keyingi qadam — to‘lov.'}</p>
      </section>

      {problem && (
        <div className={`banner ${problem.kind === 'PRICE' ? 'warn' : 'bad'}`} role="alert">
          {problem.message}
          {problem.kind === 'PRICE' && <div style={{ marginTop: 8 }}><strong>Yangi summani tasdiqlash uchun tugmani qayta bosing.</strong></div>}
          {problem.kind === 'CASH' && <div style={{ marginTop: 8 }}><Button small variant="secondary" onClick={() => { setChosen('CARD'); setProblem(null); }}>Karta bilan to‘lash</Button></div>}
          {problem.kind === 'UNAVAILABLE' && <div style={{ marginTop: 8 }}><Button small variant="secondary" onClick={() => go({ name: 'cart' })}>Savatga qaytish</Button></div>}
        </div>
      )}

      <StickyAction tone={touched && !canSubmit && taxiOptions !== null ? 'bad' : 'soft'} hint={stickyHint}>
        <Button loading={submitting} disabled={taxiOptions === null} onClick={() => void submit()}>
          {method === 'CASH' ? `Buyurtma berish • ${som(total)}` : problem?.kind === 'PRICE' ? `Yangi narxda to‘lovga o‘tish • ${som(total)}` : `To‘lovga o‘tish • ${som(total)}`}
        </Button>
      </StickyAction>
    </div>
  );
}
