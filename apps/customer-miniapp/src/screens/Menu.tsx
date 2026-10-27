import { useEffect, useMemo } from 'react';
import { ChevronLeft, Star, UtensilsCrossed } from 'lucide-react';
import { PriceTag } from '../components/FeeProgress';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Button, Empty, ErrorBox, Icon, Qty, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { cartBase, qtyOf } from '../lib/cart';
import { FLAT_PRICING, referenceUnitPrice, unitPrice } from '../lib/fee';
import { opensText } from '../lib/format';
import { mediaUrl } from '../lib/platform';
import { ratingText } from '../lib/rating';
import type { Route } from '../lib/router';
import { confirmDialog } from '../lib/telegram';
import type { Product } from '../lib/types';
import { useApp, useLoad } from '../state';

/** The group of dishes that has no category (shown as its own card in the grid). */
export const OTHER_CATEGORY = 'other';

export function Menu({ id, cat, go }: { id: string; cat?: string; go?: (r: Route) => void }) {
  const { cart, dispatch, toast } = useApp();
  const { data, error, loading, reload } = useLoad(signal => api.menu(id, signal), [id]);

  // The fee model is part of the menu: keep the cart pricing in step with what the server uses now.
  useEffect(() => { if (data?.pricing) dispatch({ type: 'pricing', pricing: data.pricing }); }, [data?.pricing, dispatch]);

  // The menu opens on the categories (a grid with the restaurant's photos); a tap opens that category's dishes. The category is part of the route, so
  // the back button returns to the grid. Without categories (or with a single group) the dishes are shown directly.
  const groups = useMemo(() => {
    const products = data?.products ?? [];
    const named = (data?.categories ?? []).map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl ?? null, count: products.filter(p => p.categoryId === c.id).length })).filter(g => g.count > 0);
    const known = new Set((data?.categories ?? []).map(c => c.id));
    const loose = products.filter(p => !p.categoryId || !known.has(p.categoryId)).length;
    return loose > 0 ? [...named, { id: OTHER_CATEGORY, name: named.length ? 'Boshqa taomlar' : 'Taomlar', imageUrl: null, count: loose }] : named;
  }, [data]);
  const showGrid = groups.length > 1;
  const active = showGrid ? groups.find(g => g.id === cat) ?? null : null;
  const visible = useMemo(() => {
    const products = data?.products ?? [];
    if (!showGrid) return products;
    if (!active) return [];
    const known = new Set((data?.categories ?? []).map(c => c.id));
    return active.id === OTHER_CATEGORY ? products.filter(p => !p.categoryId || !known.has(p.categoryId)) : products.filter(p => p.categoryId === active.id);
  }, [data, showGrid, active]);

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
        </div>
      </div>
      {!r.isOpen && (
        <div className="banner warn">{r.closedReason === 'HOURS' ? `Hozir yopiq. ${opensText(r.opensNext)}.` : 'Restoran vaqtincha buyurtma qabul qilmayapti.'} Menyuni ko‘rishingiz mumkin.</div>
      )}
      {showGrid && !active && (
        <div className="cat-grid" role="list" aria-label="Toifalar">
          {groups.map(g => (
            <button key={g.id} role="listitem" className="cat-card" onClick={() => go?.({ name: 'menu', id, cat: g.id })}>
              <RestaurantPhoto name={g.name} url={g.imageUrl} />
              <span className="cat-label"><span className="cat-name">{g.name}</span><span className="cat-count">{g.count} ta taom</span></span>
            </button>
          ))}
        </div>
      )}
      {showGrid && active && (
        <div className="row cat-head">
          <button className="chip" onClick={() => go?.({ name: 'menu', id })}><Icon as={ChevronLeft} size={18} /> Toifalar</button>
          <h2 className="grow" style={{ fontSize: 18 }}>{active.name}</h2>
        </div>
      )}
      {(!showGrid || active) && visible.length === 0 && <Empty icon={<Icon as={UtensilsCrossed} size={44} />} title="Bu toifada mahsulot yo‘q" />}
      {visible.map(p => {
        const q = inThisCart ? qtyOf(cart, p.id) : 0;
        const orderable = r.isOpen && p.isAvailable;
        // The price the dish has at the current basket (the first-rate price while the basket is empty); the earlier price is crossed out once it got cheaper.
        const first = referenceUnitPrice(p.priceSom, pricing);
        const unit = base > 0 ? unitPrice(p.priceSom, base, pricing) : first;
        return (
          <div key={p.id} className={`card product ${p.isAvailable ? '' : 'muted'}`}>
            {p.imageUrl
              ? <img className="img" src={mediaUrl(p.imageUrl) ?? ''} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
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
    </div>
  );
}
