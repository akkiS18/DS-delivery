import { useEffect, useMemo, useState } from 'react';
import { Star, UtensilsCrossed } from 'lucide-react';
import { FeeProgress, PriceTag } from '../components/FeeProgress';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Button, Empty, ErrorBox, Icon, Qty, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { cartBase, cartCount, cartTotal, qtyOf } from '../lib/cart';
import { FLAT_PRICING, referenceUnitPrice, unitPrice } from '../lib/fee';
import { opensText, som } from '../lib/format';
import { ratingText } from '../lib/rating';
import type { Route } from '../lib/router';
import { confirmDialog } from '../lib/telegram';
import type { Product } from '../lib/types';
import { useApp, useLoad } from '../state';

export function Menu({ id, go }: { id: string; go: (r: Route) => void }) {
  const { cart, dispatch, toast } = useApp();
  const { data, error, loading, reload } = useLoad(signal => api.menu(id, signal), [id]);
  const [category, setCategory] = useState<string | 'all'>('all');

  // The fee model is part of the menu: keep the cart pricing in step with what the server uses now.
  useEffect(() => { if (data?.pricing) dispatch({ type: 'pricing', pricing: data.pricing }); }, [data?.pricing, dispatch]);

  const visible = useMemo(() => (data?.products ?? []).filter(p => category === 'all' || p.categoryId === category), [data, category]);

  if (loading && !data) return <div className="page"><Skeletons n={5} /></div>;
  if (error || !data) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;
  const r = data.restaurant;

  const add = async (p: Product) => {
    if (!r.isOpen || !p.isAvailable) return;
    if (cart.restaurantId && cart.restaurantId !== r.id && cart.lines.length > 0) {
      const ok = await confirmDialog('Savatda boshqa restorandan mahsulotlar bor. Savatni tozalab, bu restorandan boshlaymizmi?');
      if (!ok) return;
    }
    dispatch({ type: 'add', restaurantId: r.id, restaurantName: r.name, product: { id: p.id, name: p.name, priceSom: p.priceSom } });
  };
  const inThisCart = cart.restaurantId === r.id;
  const count = inThisCart ? cartCount(cart) : 0;
  const pricing = data.pricing ?? cart.pricing ?? FLAT_PRICING;
  const base = inThisCart ? cartBase(cart) : 0;

  return (
    <div className="page">
      <div>
        <div className={`rphoto banner-photo ${r.isOpen ? '' : 'closed'}`}><RestaurantPhoto name={r.name} url={r.imageUrl} /></div>
        <h1 className="page-title">{r.name}</h1>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${r.isOpen ? 'open' : 'closed'}`}>{r.isOpen ? 'Ochiq' : r.closedReason === 'PAUSED' ? 'Vaqtincha yopiq' : 'Yopiq'}</span>
          {ratingText(r.rating) && <span className="rrate"><Icon as={Star} size={16} className="star on" />{ratingText(r.rating)}</span>}
          {r.isOpen && <span className="sub small">Tayyorlash ~{r.prepMinutes} daqiqa</span>}
        </div>
      </div>
      {!r.isOpen && (
        <div className="banner warn">{r.closedReason === 'HOURS' ? `Hozir yopiq. ${opensText(r.opensNext)}.` : 'Restoran vaqtincha buyurtma qabul qilmayapti.'} Menyuni ko‘rishingiz mumkin.</div>
      )}
      {data.categories.length > 0 && (
        <div className="chips" role="tablist" aria-label="Toifalar">
          <button className={`chip ${category === 'all' ? 'on' : ''}`} onClick={() => setCategory('all')}>Hammasi</button>
          {data.categories.map(c => <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>{c.name}</button>)}
        </div>
      )}
      {visible.length === 0 && <Empty icon={<Icon as={UtensilsCrossed} size={44} />} title="Bu toifada mahsulot yo‘q" />}
      {visible.map(p => {
        const q = inThisCart ? qtyOf(cart, p.id) : 0;
        const orderable = r.isOpen && p.isAvailable;
        // The price the dish has at the current basket (the first-rate price while the basket is empty); the earlier price is crossed out once it got cheaper.
        const first = referenceUnitPrice(p.priceSom, pricing);
        const unit = base > 0 ? unitPrice(p.priceSom, base, pricing) : first;
        return (
          <div key={p.id} className={`card product ${p.isAvailable ? '' : 'muted'}`}>
            {p.imageUrl
              ? <img className="img" src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <div className="img" aria-hidden><Icon as={UtensilsCrossed} size={30} /></div>}
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="bold">{p.name}</div>
              {p.description && <div className="desc">{p.description}</div>}
              <div className="row between" style={{ marginTop: 'auto' }}>
                <PriceTag unitSom={unit} referenceSom={Math.max(first, unit)} />
                {!p.isAvailable ? <span className="badge closed">Mavjud emas</span>
                  : q > 0 ? <Qty value={q} onInc={() => dispatch({ type: 'inc', productId: p.id })} onDec={() => dispatch({ type: 'dec', productId: p.id })} />
                  : <Button small disabled={!orderable} onClick={() => { void add(p); if (!r.isOpen) toast('Restoran hozir yopiq'); }}>Qo‘shish</Button>}
              </div>
            </div>
          </div>
        );
      })}
      {count > 0 && (
        <div className="cartbar">
          <FeeProgress base={base} pricing={pricing} />
          <Button onClick={() => go({ name: 'cart' })}>Savat • {count} ta • {som(cartTotal(cart))}</Button>
        </div>
      )}
    </div>
  );
}
