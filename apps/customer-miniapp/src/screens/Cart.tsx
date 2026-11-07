import { useEffect, useMemo, useState } from 'react';
import { Gift, ShoppingBasket } from 'lucide-react';
import { Fold } from '../components/Choice';
import { FeeProgress, PriceTag } from '../components/FeeProgress';
import { PlatformLine, TaxiFareBox } from '../components/PriceLines';
import { Button, Empty, Icon, Qty, Spinner, StickyAction } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cartBase, cartView, catalogAction } from '../lib/cart';
import { describeCheckoutError } from '../lib/checkoutErrors';
import { lineCharge } from '../lib/fee';
import { opensText, som } from '../lib/format';
import type { Route } from '../lib/router';
import type { CheckoutIssue, QuoteResponse } from '../lib/types';
import { useApp } from '../state';
import { t } from '../i18n';

export function Cart({ go }: { go: (r: Route) => void }) {
  const { cart, dispatch, toast } = useApp();
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [repriced, setRepriced] = useState<string[]>([]);

  // Server-side revalidation of availability, hours and CURRENT prices whenever the cart changes (debounced).
  const signature = cart.lines.map(l => `${l.productId}:${l.quantity}`).join(',');
  useEffect(() => {
    if (!cart.restaurantId || cart.lines.length === 0) { setQuote(null); return; }
    const ac = new AbortController();
    setChecking(true);
    const timer = window.setTimeout(() => {
      api.quote(cart.restaurantId!, cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })), ac.signal)
        .then(q => {
          setQuote(q); setError(null);
          if (q.pricing) dispatch({ type: 'pricing', pricing: q.pricing });
          // adopt the restaurant prices the server has now (the customer-facing price follows from them), and tell the customer what moved
          const baseOf = (sl: { unitSom: number; baseUnitSom?: number }) => sl.baseUnitSom ?? sl.unitSom;
          const moved = q.lines.filter(sl => !sl.free && !sl.packaging).filter(sl => { const l = cart.lines.find(x => x.productId === sl.productId); return l && l.priceSom !== baseOf(sl); });
          if (moved.length) {
            dispatch({ type: 'reprice', lines: moved.map(m => ({ productId: m.productId, unitSom: baseOf(m) })) });
            setRepriced(moved.map(m => m.name));
          }
        })
        .catch(e => { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); })
        .finally(() => setChecking(false));
    }, 300);
    return () => { window.clearTimeout(timer); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cart.restaurantId]);

  // A cart saved before dishes carried their description / earlier price: read them from the menu once (display only; nothing is charged from them).
  const needsDetails = cart.lines.some(l => l.description === undefined);
  useEffect(() => {
    if (!cart.restaurantId || !needsDetails) return;
    const ac = new AbortController();
    api.menu(cart.restaurantId, ac.signal).then(m => dispatch(catalogAction(m)), () => { /* the lines simply stay without a description */ });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.restaurantId, needsDetails]);

  const view = cartView(cart);
  const issues: CheckoutIssue[] = quote && !quote.ok ? quote.issues : [];
  const unavailable = useMemo(() => new Set(issues.flatMap(i => (i.kind === 'PRODUCT_UNAVAILABLE' ? [i.productId] : []))), [issues]);
  const closed = issues.find(i => i.kind === 'RESTAURANT_CLOSED' || i.kind === 'RESTAURANT_UNAVAILABLE');

  if (cart.lines.length === 0) {
    return <div className="page"><Empty icon={<Icon as={ShoppingBasket} size={44} />} title={t('Savat bo‘sh')} hint={t('Restoran menyusidan taom tanlang.')} action={<Button onClick={() => go({ name: 'home' })}>{t('Restoranlar')}</Button>} /></div>;
  }
  const blocked = unavailable.size > 0 || Boolean(closed) || !quote || !quote.ok || checking;

  return (
    <div className="page">
      <div>
        <h1 className="page-title">{t('Savat')}</h1>
        <p className="sub">{cart.restaurantName}</p>
      </div>
      {repriced.length > 0 && <div className="banner warn" role="alert">{t('Narx yangilandi: {names}. Yangi summani tekshiring.', { names: repriced.join(', ') })}</div>}
      {closed && <div className="banner bad" role="alert">{closed.kind === 'RESTAURANT_CLOSED' ? t('Restoran hozir yopiq. {opens}.', { opens: opensText(closed.opensNext) }) : t('Restoran hozir buyurtma qabul qilmayapti.')}</div>}
      {error && <div className="banner bad" role="alert">{describeCheckoutError(error).message}</div>}
      {view.lines.map(l => (
        <div key={l.productId} className={`card ${unavailable.has(l.productId) ? 'muted' : ''}`}>
          <div className="row between">
            <div className="grow">
              <div className="bold">{l.name}</div>
              {l.description && <div className="sub small line-desc">{l.description}</div>}
              <div className="sub small"><PriceTag unitSom={l.unitSom} referenceSom={l.wasSom} />{unavailable.has(l.productId) ? ` • ${t('hozir mavjud emas')}` : ''}</div>
            </div>
            <div className="bold mono">{som(l.subtotalSom)}</div>
          </div>
          {l.freeQty > 0 && <div className="row between free-row"><span className="row" style={{ gap: 6 }}><Icon as={Gift} size={16} />{t('{n} ta bepul (1+1 aksiya)', { n: l.freeQty })}</span><span className="mono"><span className="strike">{som(l.freeQty * l.priceSom)}</span> <b>0</b></span></div>}
          <div className="row between" style={{ marginTop: 10 }}>
            <Qty value={l.quantity} onInc={() => dispatch({ type: 'inc', productId: l.productId })} onDec={() => dispatch({ type: 'dec', productId: l.productId })} />
            <Button small variant="ghost" onClick={() => dispatch({ type: 'remove', productId: l.productId })} aria-label={t('{name} ni olib tashlash', { name: l.name })}>{t('Olib tashlash')}</Button>
          </div>
          {unavailable.has(l.productId) && <div className="err">{t('Bu mahsulot mavjud emas — olib tashlang.')}</div>}
        </div>
      ))}
      {view.extras.map(x => (
        <div key={x.productId} className="card">
          <div className="row between">
            <div className="grow">
              <div className="bold">{x.name}</div>
              <div className="sub small">{som(x.unitSom)} • {t('har bir taom uchun avtomatik')}</div>
            </div>
            <div className="bold mono">{x.quantity} × = {som(x.subtotalSom)}</div>
          </div>
        </div>
      ))}
      <div className="card stack">
        <div className="row between"><span>{t('Taomlar')}</span><span className="bold mono">{som(quote?.ok ? quote.totalSom - lineCharge(view.pricing) : view.dishesSom)}</span></div>
        {view.savedSom > 0 && <div className="row between saved"><span>{t('Tejadingiz')}</span><span className="mono">−{som(view.savedSom)}</span></div>}
        {view.dealSavedSom > 0 && <div className="row between saved"><span>{t('Aksiya chegirmasi')}</span><span className="mono">−{som(view.dealSavedSom)}</span></div>}
        {view.promoSavedSom > 0 && <div className="row between saved"><span>{t('Aksiya (1+1)')}</span><span className="mono">−{som(view.promoSavedSom)}</span></div>}
        <PlatformLine pricing={view.pricing} />
        <FeeProgress base={cartBase(cart)} pricing={view.pricing} />
        {view.pricing.mode !== 'FLAT' && view.pricing.mode !== 'LINE' && <p className="sub small">{t('Narxlarga xizmat haqi kiritilgan.')}</p>}
        {view.pricing.mode === 'LINE' && <div className="row between bold"><span>{t('Jami (taksidan tashqari)')}</span><span className="mono">{som(quote?.ok ? quote.totalSom : view.totalSom)}</span></div>}
      </div>
      <Fold title={t('Taksi haqi haqida')}><TaxiFareBox /></Fold>
      {unavailable.size > 0 && (
        <Button variant="secondary" onClick={() => dispatch({ type: 'drop', productIds: [...unavailable] })}>{t('Mavjud bo‘lmaganlarni olib tashlash')}</Button>
      )}
      {checking && <Spinner />}
      <Button variant="ghost" onClick={() => { dispatch({ type: 'clear' }); toast(t('Savat tozalandi')); go({ name: 'home' }); }}>{t('Savatni tozalash')}</Button>
      <StickyAction hint={checking ? t('Narxlar tekshirilmoqda…') : blocked ? null : t('Keyingi qadam: manzil va to‘lov usuli')}>
        <Button disabled={blocked} onClick={() => { setRepriced([]); go({ name: 'checkout' }); }}>{t('Rasmiylashtirish • {sum}', { sum: som(quote?.ok ? quote.totalSom : view.totalSom) })}</Button>
      </StickyAction>
    </div>
  );
}
