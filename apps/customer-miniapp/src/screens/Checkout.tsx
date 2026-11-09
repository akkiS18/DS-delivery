import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CircleCheck, CreditCard, Footprints, MapPin, ShoppingBasket, Truck } from 'lucide-react';
import { Fold, TaxiTile, Tile } from '../components/Choice';
import { LocationPicker } from '../components/LocationPicker';
import type { MapState } from '../lib/mapConfig';
import { PlatformLine, TaxiFareBox } from '../components/PriceLines';
import { Button, Empty, Icon, Sheet, Spinner, StickyAction } from '../components/ui';
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
import { t } from '../i18n';

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
  const [text, setText] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapState, setMapState] = useState<MapState>('loading');
  const [save, setSave] = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const phoneEdited = useRef(false);
  const [walk, setWalk] = useState(false);
  // Walking is offered only by a restaurant that allows it (the server says so in the quote); everywhere else the option is not shown.
  const [walkingAvailable, setWalkingAvailable] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Described | null>(null);
  // The "taxi fare is separate" question that comes before every order (card and cash alike): open = waiting for "Ha" or "Ortga".
  const [asking, setAsking] = useState(false);
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

  // The saved phone is put into the input (the customer can still change it); an empty profile leaves the input empty.
  useEffect(() => {
    if (profile?.phone && !phoneEdited.current) setPhoneInput(formatPhone(profile.phone));
  }, [profile?.phone]);

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

  if (cart.lines.length === 0) return <div className="page"><Empty icon={<Icon as={ShoppingBasket} size={44} />} title={t('Savat bo‘sh')} action={<Button onClick={() => go({ name: 'home' })}>{t('Restoranlar')}</Button>} /></div>;
  if (!profile) return <div className="page"><Spinner /></div>;

  const savedAddress = addresses.find(a => a.id === selected) ?? null;
  const newErrors = selected === 'new' ? validateAddress({ addressText: text, lat: coords?.lat ?? null, lng: coords?.lng ?? null }) : {};
  const phone = normalizePhone(phoneInput);
  const ready = checkoutReady({ addressText: selected === 'new' ? text : savedAddress?.addressText ?? null, phone });
  // Several services and none picked yet: the customer must choose. No services at all (or the list failed): the server answers with the reason.
  const taxiMissing = taxiOptions !== null && taxiOptions.length > 1 && taxiId === null;
  // A new address needs a spot on the map (the taxi navigates to it). Only when the map itself cannot be shown does the text address stand alone.
  const needPin = selected === 'new' && mapState !== 'failed' && !coords;
  const canSubmit = ready.ok && !hasErrors(newErrors) && !needPin && !submitting && taxiOptions !== null && !taxiMissing;
  const view = cartView(cart);
  const total = view.totalSom;

  const missingText = [
    ready.missing.includes('address') || (selected === 'new' && hasErrors(newErrors)) ? t('Manzilni kiriting') : '',
    needPin ? t('Xaritada joyni belgilang') : '',
    ready.missing.includes('phone') ? t('Telefon raqamini kiriting') : '',
    taxiMissing ? t('Taksi xizmatini tanlang') : '',
  ].filter(Boolean).join(' • ');
  const stickyHint = touched && !canSubmit && taxiOptions !== null && missingText
    ? missingText
    : method === 'CASH' ? t('Restoran tasdiqlagach taom tayyorlanadi, pulni haydovchiga berasiz') : t('Keyingi ekranda restoran kartasiga o‘tkazma qilasiz');

  const locate = () => {
    if (!navigator.geolocation) { toast(t('Joylashuvni aniqlab bo‘lmadi')); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setCoords({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); toast(t('Joylashuv qo‘shildi')); },
      () => toast(t('Joylashuvga ruxsat berilmadi')), { timeout: 8000, maximumAge: 60_000 });
  };

  const submit = async () => {
    setTouched(true);
    if (busy.current) return;   // a ref, not just state: two taps in the same frame still send one request
    if (!canSubmit) {
      // Not silently disabled: say what is missing and take the customer to it.
      const target = (selected === 'new' && hasErrors(newErrors)) || ready.missing.includes('address') || needPin ? 'co-address' : ready.missing.includes('phone') ? 'co-phone' : taxiMissing ? 'co-delivery' : null;
      if (target) window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    setAsking(true); // the order is placed by place(), after the customer has seen that the taxi fare is separate and said "Ha"
  };

  const place = async () => {
    setAsking(false);
    if (busy.current) return;
    busy.current = true; setSubmitting(true); setProblem(null);
    const body: CheckoutBody = {
      checkoutKey: keyFor(signature),
      restaurantId: cart.restaurantId!,
      items: cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })),
      expectedTotalSom: total,
      expectedUnitPrices: Object.fromEntries(view.lines.map(l => [l.productId, l.unitSom])),
      ...(selected === 'new'
        ? { address: { addressText: text.trim(), ...(coords ?? {}), save } }
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
      <h1 className="page-title">{t('Buyurtmani rasmiylashtirish')}</h1>

      <section className="stack" id="co-address" aria-label={t('Yetkazish manzili')}>
        <h2 style={{ fontSize: 17 }}>{t('Yetkazish manzili')}</h2>
        {addresses.map(a => (
          <label key={a.id} className="card row" style={{ border: selected === a.id ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
            <input type="radio" name="addr" checked={selected === a.id} onChange={() => setSelected(a.id)} style={{ width: 22, height: 22 }} />
            <div className="grow">
              <div className="bold">{a.label}{a.isDefault && <span className="badge" style={{ marginLeft: 8 }}>{t('Asosiy')}</span>}</div>
              <div className="sub small">{a.addressText}</div>
            </div>
          </label>
        ))}
        <label className="card row" style={{ border: selected === 'new' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer' }}>
          <input type="radio" name="addr" checked={selected === 'new'} onChange={() => setSelected('new')} style={{ width: 22, height: 22 }} />
          <span className="bold">{t('+ Yangi manzil')}</span>
        </label>
        {selected === 'new' && (
          <div className="card stack">
            <div className="field"><label htmlFor="adr">{t('Manzil')}</label>
              <textarea id="adr" className={`input ${touched && newErrors.addressText ? 'invalid' : ''}`} rows={3} value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder={t('Ko‘cha, uy, kvartira, mo‘ljal')} />
              {touched && newErrors.addressText && <div className="err">{newErrors.addressText}</div>}</div>
            {mapState !== 'failed'
              ? <LocationPicker value={coords} onPick={setCoords} onState={setMapState} />
              : <Button variant="secondary" onClick={locate}><Icon as={coords ? CircleCheck : MapPin} />{coords ? t('Joylashuv qo‘shildi') : t('Joylashuvni qo‘shish (ixtiyoriy)')}</Button>}
            <label className="row"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} style={{ width: 22, height: 22 }} /> {t('Keyingi buyurtmalar uchun saqlash')}</label>
          </div>
        )}
      </section>

      <section className="stack" id="co-phone" aria-label={t('Telefon')}>
        <h2 style={{ fontSize: 17 }}>{t('Telefon raqami')}</h2>
        <div className="field">
          <input className={`input ${touched && !phone ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phoneInput}
            onChange={e => { phoneEdited.current = true; setPhoneInput(e.target.value); }} aria-label={t('Telefon raqami')} />
          {touched && !phone && <div className="err">{t('Telefon raqamini to‘g‘ri kiriting (masalan, 90 123 45 67)')}</div>}
        </div>
      </section>

      <section className="stack" id="co-delivery" aria-label={t('Yetkazish usuli')}>
        <h2 style={{ fontSize: 17 }}>{t('Yetkazish usuli')}</h2>
        {taxiOptions === null && !taxiFailed && <Spinner />}
        {taxiFailed && <div className="banner warn" role="alert">{t('Taksi xizmatlari ro‘yxatini yuklab bo‘lmadi.')} <Button small variant="secondary" onClick={loadTaxis}>{t('Qayta urinish')}</Button></div>}
        {taxiOptions !== null && taxiOptions.length === 0 && <div className="banner warn" role="alert">{t('Hozir yetkazib berish uchun taksi xizmati mavjud emas. Birozdan keyin urinib ko‘ring.')}</div>}
        {taxiOptions !== null && taxiOptions.length > 0 && (
          <div className="tiles" role="radiogroup" aria-label={t('Yetkazish usuli')}>
            {taxiOptions.map(opt => (
              <TaxiTile key={opt.id} name={opt.name} number={opt.phone} on={!walk && taxiId === opt.id} onPick={() => { setTaxiId(opt.id); setWalk(false); }} />
            ))}
            {walkingAvailable && (
              <Tile icon={Footprints} title={t('Piyoda')} sub={t('Restoran rozi bo‘lsa, haq yo‘q')} on={walk}
                onPick={() => { setWalk(true); if (!taxiId && taxiOptions.length > 0) setTaxiId(taxiOptions[0]!.id); }} />
            )}
          </div>
        )}
        {touched && taxiMissing && <div className="err">{t('Taksi xizmatini tanlang.')}</div>}
      </section>

      {choices.cash && (
        <section className="stack" aria-label={t('To‘lov usuli')}>
          <h2 style={{ fontSize: 17 }}>{t('Taom uchun to‘lov')}</h2>
          <div className="tiles" role="radiogroup" aria-label={t('To‘lov usuli')}>
            {choices.card && <Tile icon={CreditCard} title={t('Karta')} sub={choices.cardBusy ? t('Navbat bo‘lishi mumkin') : t('Kartaga o‘tkazma')} on={method === 'CARD'} onPick={() => setChosen('CARD')} />}
            <Tile icon={Banknote} title={t('Naqd pul')} sub={t('Haydovchiga berasiz')} on={method === 'CASH'} onPick={() => setChosen('CASH')} />
          </div>
        </section>
      )}

      <section className="card stack" aria-label={t('Buyurtma xulosasi')}>
        <h2 style={{ fontSize: 17 }}>{t('Buyurtma')}</h2>
        <div className="sub small">{cart.restaurantName} • {t('{n} ta', { n: cartCount(cart) })}</div>
        {view.lines.map(l => <div key={l.productId} className="row between small"><span className="grow">{l.quantity} × {l.name}{l.freeQty > 0 ? ` (${t('{n} ta bepul', { n: l.freeQty })})` : ''}</span><span className="mono">{som(l.subtotalSom)}</span></div>)}
        {view.extras.map(x => <div key={x.productId} className="row between small"><span className="grow">{x.quantity} × {x.name}</span><span className="mono">{som(x.subtotalSom)}</span></div>)}
        {view.dealSavedSom > 0 && <div className="row between small saved"><span>{t('Aksiya chegirmasi')}</span><span className="mono">−{som(view.dealSavedSom)}</span></div>}
        {view.promoSavedSom > 0 && <div className="row between small saved"><span>{t('Aksiya (1+1)')}</span><span className="mono">−{som(view.promoSavedSom)}</span></div>}
        <div className="divider" />
        <div className="row between"><span className="bold">{t('Taomlar')}</span><span className="bold mono">{som(view.dishesSom)}</span></div>
        <PlatformLine pricing={view.pricing} />
        {view.pricing.mode === 'LINE' && <div className="row between"><span className="bold">{t('Jami (taksidan tashqari)')}</span><span className="bold mono">{som(total)}</span></div>}
        <Fold title={t('Qo‘shimcha')}>
          <TaxiFareBox walk={walk && walkingAvailable} taxiName={taxiOptions?.find(o => o.id === taxiId)?.name ?? null} />
          <p className="sub small">{method === 'CASH' ? t('Naqd to‘lov: restoran tasdiqlagach taom tayyorlanadi, pulni yetkazib berganda haydovchiga berasiz.') : t('Taom uchun to‘lov to‘g‘ridan-to‘g‘ri restoranga. Keyingi qadam — to‘lov.')}</p>
        </Fold>
      </section>

      {problem && (
        <div className={`banner ${problem.kind === 'PRICE' ? 'warn' : 'bad'}`} role="alert">
          {problem.message}
          {problem.kind === 'PRICE' && <div style={{ marginTop: 8 }}><strong>{t('Yangi summani tasdiqlash uchun tugmani qayta bosing.')}</strong></div>}
          {problem.kind === 'CASH' && <div style={{ marginTop: 8 }}><Button small variant="secondary" onClick={() => { setChosen('CARD'); setProblem(null); }}>{t('Karta bilan to‘lash')}</Button></div>}
          {problem.kind === 'UNAVAILABLE' && <div style={{ marginTop: 8 }}><Button small variant="secondary" onClick={() => go({ name: 'cart' })}>{t('Savatga qaytish')}</Button></div>}
        </div>
      )}

      {asking && (
        <Sheet title={t('Taksi haqi alohida')} onClose={() => setAsking(false)}>
          <div className="stack">
            <div className="banner warn notice" role="note">
              <Icon as={Truck} size={22} />
              <div>
                <strong>{t('Taom narxi {sum}. Yetkazib berish (taksi) haqi bunga kirmaydi.', { sum: som(total) })}</strong>
                <div>{t('Taomni olgach, {who} xizmatiga taksi haqini alohida to‘laysiz. Narxni xizmatning o‘zi aytadi.', { who: taxiOptions?.find(o => o.id === taxiId)?.name ? `«${taxiOptions.find(o => o.id === taxiId)!.name}»` : t('taksi xizmati') })}</div>
                {walk && walkingAvailable && <div>{t('Restoran piyoda olib borishga rozi bo‘lsa, taksi haqi olinmaydi; rozi bo‘lmasa, taksi olib boradi va haq to‘lanadi.')}</div>}
                {method === 'CASH' && <div>{t('Taom pulini ({sum}) esa naqd holda haydovchiga berasiz.', { sum: som(total) })}</div>}
              </div>
            </div>
            <Button onClick={() => void place()}>{t('Ha, tushundim')}</Button>
            <Button variant="secondary" onClick={() => setAsking(false)}>{t('Ortga')}</Button>
          </div>
        </Sheet>
      )}

      <StickyAction tone={touched && !canSubmit && taxiOptions !== null ? 'bad' : 'soft'} hint={stickyHint}>
        <Button loading={submitting} disabled={taxiOptions === null} onClick={() => void submit()}>
          {method === 'CASH' ? t('Buyurtma berish • {sum}', { sum: som(total) }) : problem?.kind === 'PRICE' ? t('Yangi narxda to‘lovga o‘tish • {sum}', { sum: som(total) }) : t('To‘lovga o‘tish • {sum}', { sum: som(total) })}
        </Button>
      </StickyAction>
    </div>
  );
}
