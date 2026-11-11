import { useEffect, useMemo } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Star, UtensilsCrossed } from 'lucide-react';
import { PriceTag } from '../components/FeeProgress';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Empty, ErrorBox, Icon, Qty, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { cartBase, catalogAction, qtyOf } from '../lib/cart';
import { FLAT_PRICING, referenceUnitPrice, unitPrice } from '../lib/fee';
import { opensText, som } from '../lib/format';
import { mediaUrl } from '../lib/platform';
import { ratingText } from '../lib/rating';
import type { Route } from '../lib/router';
import { confirmDialog, haptic } from '../lib/telegram';
import type { Product } from '../lib/types';
import { useApp, useLoad } from '../state';
import { t } from '../i18n';

/** The group of dishes that has no category (shown as its own card in the grid). */
export const OTHER_CATEGORY = 'other';
/** The virtual first group of a restaurant that has a 1+1 offer on (owner decision 2026-11-01): the offer's dishes, whatever category they sit in. */
export const PROMO_CATEGORY = 'promo';
/** A restaurant's own group of special offers ("AKSIYA"): without a photo it gets a discount badge instead of the first letter. */
export const isDealGroup = (name: string): boolean => /^\s*(aksiya|акция|акции)/i.test(name);

export function Menu({ id, cat, go }: { id: string; cat?: string; go?: (r: Route, o?: { replace?: boolean }) => void }) {
  const { cart, dispatch, toast } = useApp();
  const { data, error, loading, reload } = useLoad(signal => api.menu(id, signal), [id]);

  // The fee model is part of the menu: keep the cart pricing in step with what the server uses now.
  useEffect(() => { if (data?.pricing) dispatch({ type: 'pricing', pricing: data.pricing }); }, [data?.pricing, dispatch]);
  // ...and so are the restaurant's 1+1 offers and the packaging of each dish (the cart shows them as lines of their own).
  useEffect(() => {
    if (!data || cart.restaurantId !== data.restaurant.id) return;
    dispatch(catalogAction(data));
  }, [data, cart.restaurantId, dispatch]);
  const promoIds = useMemo(() => new Set((data?.promotions ?? []).flatMap(p => p.productIds)), [data]);

  // The menu opens on the categories (a grid with the restaurant's photos); a tap opens that category's dishes. The category is part of the route, so
  // the back button returns to the grid. Without categories (or with a single group) the dishes are shown directly.
  const groups = useMemo(() => {
    const products = data?.products ?? [];
    const named = (data?.categories ?? []).map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl ?? null, count: products.filter(p => p.categoryId === c.id).length })).filter(g => g.count > 0);
    const known = new Set((data?.categories ?? []).map(c => c.id));
    const loose = products.filter(p => !p.categoryId || !known.has(p.categoryId)).length;
    const all = loose > 0 ? [...named, { id: OTHER_CATEGORY, name: named.length ? t('Boshqa taomlar') : t('Taomlar'), imageUrl: null, count: loose }] : named;
    const offered = products.filter(p => promoIds.has(p.id)).length;
    return offered > 0 ? [{ id: PROMO_CATEGORY, name: t('Chegirmalar'), imageUrl: null, count: offered }, ...all] : all;
  }, [data, promoIds]);
  const showGrid = groups.length > 1;
  const active = showGrid ? groups.find(g => g.id === cat) ?? null : null;
  const visible = useMemo(() => {
    const products = data?.products ?? [];
    if (!showGrid) return products;
    if (!active) return [];
    if (active.id === PROMO_CATEGORY) return products.filter(p => promoIds.has(p.id));
    const known = new Set((data?.categories ?? []).map(c => c.id));
    return active.id === OTHER_CATEGORY ? products.filter(p => !p.categoryId || !known.has(p.categoryId)) : products.filter(p => p.categoryId === active.id);
  }, [data, showGrid, active, promoIds]);

  if (loading && !data) return <div className="page"><Skeletons n={5} /></div>;
  if (error || !data) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;
  const r = data.restaurant;

  const add = async (p: Product) => {
    if (!r.isOpen || !p.isAvailable) return;
    if (cart.restaurantId && cart.restaurantId !== r.id && cart.lines.length > 0) {
      const ok = await confirmDialog(t('Savatda boshqa restorandan mahsulotlar bor. Savatni tozalab, bu restorandan boshlaymizmi?'));
      if (!ok) return;
    }
    dispatch({ type: 'add', restaurantId: r.id, restaurantName: r.name, product: { id: p.id, name: p.name, priceSom: p.priceSom, packaging: p.packaging ?? null, description: p.description, oldPriceSom: p.oldPriceSom ?? null } });
  };
  const inThisCart = cart.restaurantId === r.id;
  const pricing = data.pricing ?? cart.pricing ?? FLAT_PRICING;
  const base = inThisCart ? cartBase(cart) : 0;

  const stateLabel = r.isOpen ? t('Ochiq') : r.closedReason === 'PAUSED' ? t('Vaqtincha yopiq') : t('Yopiq');
  const isRed = (g: { id: string; name: string; imageUrl: string | null }) => g.id === PROMO_CATEGORY || (!g.imageUrl && isDealGroup(g.name));
  const back = () => go?.({ name: 'home' });

  return (
    <>
      {!active ? (
        // Categories: the restaurant's logo, dimmed, behind its name; the groups are wide chips that fill the screen width without scrolling.
        <header className="rest-head">
          <div className={`rphoto ${r.isOpen ? '' : 'closed'}`} aria-hidden><RestaurantPhoto name={r.name} url={r.imageUrl} whole /></div>
          <span className="rest-head-dim" aria-hidden />
          <button type="button" className="round-back on-photo" onClick={back} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>
          <div className="rest-head-info">
            <h1>{r.name}</h1>
            <div className="row" style={{ gap: 8 }}>
              <span className={`badge ${r.isOpen ? 'open' : 'closed'}`}>{stateLabel}</span>
              {ratingText(r.rating) && <span className="rrate on-photo"><Icon as={Star} size={15} className="star on" />{ratingText(r.rating)}</span>}
            </div>
          </div>
        </header>
      ) : (
        // A group's dishes: a bar with the restaurant, and the other groups one tap away.
        <div className="menu-top">
          <header className="menu-top-row">
            <button type="button" className="round-back" onClick={() => go?.({ name: 'menu', id })} aria-label={t('Toifalar')}><Icon as={ChevronLeft} size={22} /></button>
            <div className="grow" style={{ minWidth: 0 }}>
              <h1 className="ellipsis">{r.name}</h1>
              <div className="menu-top-sub"><span>{stateLabel}</span>{ratingText(r.rating) && <><span aria-hidden>•</span><Icon as={Star} size={14} className="star on" /><b>{ratingText(r.rating)}</b></>}</div>
            </div>
          </header>
          <div className="cat-strip" role="tablist" aria-label={t('Toifalar')}>
            {groups.map(g => (
              <button key={g.id} type="button" role="tab" aria-selected={g.id === active.id} className={`pill ${g.id === active.id ? 'on' : ''} ${isRed(g) ? 'red' : ''}`}
                onClick={() => go?.({ name: 'menu', id, cat: g.id }, { replace: true })}>{g.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="page">
      {!r.isOpen && (
        <div className="banner warn">{r.closedReason === 'HOURS' ? t('Hozir yopiq. {opens}.', { opens: opensText(r.opensNext) }) : t('Restoran vaqtincha buyurtma qabul qilmayapti.')} {t('Menyuni ko‘rishingiz mumkin.')}</div>
      )}
      {r.reservation && !active && (
        <button type="button" className="helpbar" onClick={() => go?.({ name: 'reserve', id })}><Icon as={CalendarClock} size={18} /><span>{t('Joy bron qilish • oldindan to‘lov {sum}', { sum: som(r.reservation.depositSom) })}</span><Icon as={ChevronRight} size={18} /></button>
      )}
      {showGrid && !active && (
        <>
          <h2 className="cats-title">{t('Nimani tanlaysiz?')}</h2>
          <div className="cat-chips" role="list" aria-label={t('Toifalar')}>
            {groups.map(g => (
              <button key={g.id} type="button" role="listitem" className={`cat-chip ${isRed(g) ? 'red' : ''}`} onClick={() => go?.({ name: 'menu', id, cat: g.id })}>
                {g.id === PROMO_CATEGORY ? '1+1' : g.name}{g.id !== PROMO_CATEGORY && <span className="n">{g.count}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {showGrid && active && (
        <div className="row between cat-title-row">
          <h2>{active.name}</h2>
          <span className="sub small">{t('{n} ta taom', { n: active.count })}</span>
        </div>
      )}
      {(!showGrid || active) && visible.length === 0 && <Empty icon={<Icon as={UtensilsCrossed} size={44} />} title={t('Bu toifada mahsulot yo‘q')} />}
      {visible.map(p => {
        const q = inThisCart ? qtyOf(cart, p.id) : 0;
        const orderable = r.isOpen && p.isAvailable;
        // The price the dish has at the current basket (the first-rate price while the basket is empty); the earlier price is crossed out once it got cheaper.
        const first = referenceUnitPrice(p.priceSom, pricing);
        const unit = base > 0 ? unitPrice(p.priceSom, base, pricing) : first;
        return (
          <div key={p.id} className={`card product menu-dish ${p.isAvailable ? '' : 'muted'}`}>
            {p.imageUrl
              ? <img className="img" src={mediaUrl(p.imageUrl, 320) ?? ''} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <div className="img" aria-hidden><Icon as={UtensilsCrossed} size={30} /></div>}
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="bold">{p.name}{promoIds.has(p.id) && <span className="badge promo-badge">1+1</span>}</div>
              {p.description && <div className="desc">{p.description}</div>}
              {p.packaging && <div className="sub small">{t('+ {name} {sum} (har bir dona uchun)', { name: p.packaging.name.toLowerCase(), sum: som(p.packaging.priceSom) })}</div>}
              <div className="row between" style={{ marginTop: 'auto' }}>
                <PriceTag unitSom={unit} referenceSom={Math.max(first, unit, p.oldPriceSom && p.oldPriceSom > p.priceSom ? referenceUnitPrice(p.oldPriceSom, pricing) : 0)} />
                {!p.isAvailable ? <span className="badge closed">{t('Mavjud emas')}</span>
                  : q > 0 ? <Qty value={q} onInc={() => dispatch({ type: 'inc', productId: p.id })} onDec={() => dispatch({ type: 'dec', productId: p.id })} />
                  : <button type="button" className="addfab" disabled={!orderable} aria-label={`${p.name} — ${t('Qo‘shish')}`} onClick={() => { haptic.tap(); void add(p); if (!r.isOpen) toast(t('Restoran hozir yopiq')); }}><Icon as={Plus} size={22} /></button>}
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}
