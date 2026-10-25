import { useEffect, useMemo, useState } from 'react';
import { ShoppingBasket } from 'lucide-react';
import { FeeProgress, PriceTag } from '../components/FeeProgress';
import { Button, Empty, Icon, Qty, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cartBase, cartView } from '../lib/cart';
import { describeCheckoutError } from '../lib/checkoutErrors';
import { opensText, som } from '../lib/format';
import type { Route } from '../lib/router';
import type { CheckoutIssue, QuoteResponse } from '../lib/types';
import { useApp } from '../state';

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
    const t = window.setTimeout(() => {
      api.quote(cart.restaurantId!, cart.lines.map(l => ({ productId: l.productId, quantity: l.quantity })), ac.signal)
        .then(q => {
          setQuote(q); setError(null);
          if (q.pricing) dispatch({ type: 'pricing', pricing: q.pricing });
          // adopt the restaurant prices the server has now (the customer-facing price follows from them), and tell the customer what moved
          const baseOf = (sl: { unitSom: number; baseUnitSom?: number }) => sl.baseUnitSom ?? sl.unitSom;
          const moved = q.lines.filter(sl => { const l = cart.lines.find(x => x.productId === sl.productId); return l && l.priceSom !== baseOf(sl); });
          if (moved.length) {
            dispatch({ type: 'reprice', lines: moved.map(m => ({ productId: m.productId, unitSom: baseOf(m) })) });
            setRepriced(moved.map(m => m.name));
          }
        })
        .catch(e => { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); })
        .finally(() => setChecking(false));
    }, 300);
    return () => { window.clearTimeout(t); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cart.restaurantId]);

  const view = cartView(cart);
  const issues: CheckoutIssue[] = quote && !quote.ok ? quote.issues : [];
  const unavailable = useMemo(() => new Set(issues.flatMap(i => (i.kind === 'PRODUCT_UNAVAILABLE' ? [i.productId] : []))), [issues]);
  const closed = issues.find(i => i.kind === 'RESTAURANT_CLOSED' || i.kind === 'RESTAURANT_UNAVAILABLE');

  if (cart.lines.length === 0) {
    return <div className="page"><Empty icon={<Icon as={ShoppingBasket} size={44} />} title="Savat bo‘sh" hint="Restoran menyusidan taom tanlang." action={<Button onClick={() => go({ name: 'home' })}>Restoranlar</Button>} /></div>;
  }
  const blocked = unavailable.size > 0 || Boolean(closed) || !quote || !quote.ok || checking;

  return (
    <div className="page">
      <div>
        <h1 className="page-title">Savat</h1>
        <p className="sub">{cart.restaurantName}</p>
      </div>
      {repriced.length > 0 && <div className="banner warn" role="alert">Narx yangilandi: {repriced.join(', ')}. Yangi summani tekshiring.</div>}
      {closed && <div className="banner bad" role="alert">{closed.kind === 'RESTAURANT_CLOSED' ? `Restoran hozir yopiq. ${opensText(closed.opensNext)}.` : 'Restoran hozir buyurtma qabul qilmayapti.'}</div>}
      {error && <div className="banner bad" role="alert">{describeCheckoutError(error).message}</div>}
      {view.lines.map(l => (
        <div key={l.productId} className={`card ${unavailable.has(l.productId) ? 'muted' : ''}`}>
          <div className="row between">
            <div className="grow">
              <div className="bold">{l.name}</div>
              <div className="sub small"><PriceTag unitSom={l.unitSom} referenceSom={l.referenceSom} />{unavailable.has(l.productId) ? ' • hozir mavjud emas' : ''}</div>
            </div>
            <div className="bold mono">{som(l.subtotalSom)}</div>
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <Qty value={l.quantity} onInc={() => dispatch({ type: 'inc', productId: l.productId })} onDec={() => dispatch({ type: 'dec', productId: l.productId })} />
            <Button small variant="ghost" onClick={() => dispatch({ type: 'remove', productId: l.productId })} aria-label={`${l.name} ni olib tashlash`}>Olib tashlash</Button>
          </div>
          {unavailable.has(l.productId) && <div className="err">Bu mahsulot mavjud emas — olib tashlang.</div>}
        </div>
      ))}
      <div className="card stack">
        <div className="row between"><span>Taomlar</span><span className="bold mono">{som(quote?.ok ? quote.totalSom : view.totalSom)}</span></div>
        {view.savedSom > 0 && <div className="row between saved"><span>Tejadingiz</span><span className="mono">−{som(view.savedSom)}</span></div>}
        <FeeProgress base={cartBase(cart)} pricing={view.pricing} />
        {view.pricing.mode !== 'FLAT' && <p className="sub small">Narxlarga xizmat haqi kiritilgan.</p>}
        <div className="row between sub small"><span>Yetkazish</span><span>taksi tarifi bo‘yicha</span></div>
        <p className="sub small">Yetkazish narxini taksi xizmati belgilaydi va alohida to‘lanadi. Platforma uni oldindan hisoblamaydi.</p>
      </div>
      {unavailable.size > 0 && (
        <Button variant="secondary" onClick={() => dispatch({ type: 'drop', productIds: [...unavailable] })}>Mavjud bo‘lmaganlarni olib tashlash</Button>
      )}
      {checking && <Spinner />}
      <Button disabled={blocked} onClick={() => { setRepriced([]); go({ name: 'checkout' }); }}>Rasmiylashtirish</Button>
      <Button variant="ghost" onClick={() => { dispatch({ type: 'clear' }); toast('Savat tozalandi'); go({ name: 'home' }); }}>Savatni tozalash</Button>
    </div>
  );
}
