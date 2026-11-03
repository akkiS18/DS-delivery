import { memo, startTransition, useEffect, useRef, useState } from 'react';
import { Search, Star, UtensilsCrossed, X } from 'lucide-react';
import { BannerCarousel } from '../components/BannerCarousel';
import { PriceTag } from '../components/FeeProgress';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { FLAT_PRICING, referenceUnitPrice } from '../lib/fee';
import { opensText } from '../lib/format';
import { mediaUrl } from '../lib/platform';
import { ratingText } from '../lib/rating';
import type { Route } from '../lib/router';
import type { PublicPricing, Restaurant, SearchDish, SearchResponse } from '../lib/types';
import { useLoad } from '../state';
import { t } from '../i18n';

/** Survives Home unmounting (menu -> back) so the customer returns to the same search. Cleared with the page, not persisted. */
let rememberedSearch = '';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const CACHE_MS = 60_000;
const CACHE_MAX = 40;

/** Answers of the last minute: backspacing or re-typing a word costs no request. */
const answers = new Map<string, { at: number; value: SearchResponse }>();
async function searchCached(q: string, signal: AbortSignal): Promise<SearchResponse> {
  const key = q.toLowerCase();
  const hit = answers.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await api.search(q, signal);
  if (answers.size >= CACHE_MAX) answers.delete(answers.keys().next().value as string);
  answers.set(key, { at: Date.now(), value });
  return value;
}

const stateText = (r: { isOpen: boolean; closedReason: 'PAUSED' | 'HOURS' | null }) => (r.isOpen ? t('Ochiq') : r.closedReason === 'PAUSED' ? t('Vaqtincha yopiq') : t('Yopiq'));

const RestaurantCard = memo(function RestaurantCard({ r, go }: { r: Restaurant; go: (r: Route) => void }) {
  return (
    <div className={`card tap rcard ${r.isOpen ? '' : 'closed'}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.isOpen ? t('ochiq') : t('yopiq')}`}
      onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
      <div className="rphoto">
        <RestaurantPhoto name={r.name} url={r.imageUrl} />
        <span className={`badge rstate ${r.isOpen ? 'open' : 'closed'}`}>{stateText(r)}</span>
      </div>
      <div className="rbody">
        <h3 className="rname">{r.name}</h3>
        <div className="rmeta">
          {ratingText(r.rating) && <span className="rrate"><Icon as={Star} size={16} className="star on" />{ratingText(r.rating)}</span>}
          {!r.isOpen && <span className="sub">{r.closedReason === 'HOURS' ? opensText(r.opensNext) : t('Hozircha buyurtma qabul qilmaydi')}</span>}
        </div>
      </div>
    </div>
  );
});

/** A restaurant that matched the search: one compact row. */
const RestaurantRow = memo(function RestaurantRow({ r, go }: { r: Restaurant; go: (r: Route) => void }) {
  return (
    <div className={`card tap sres ${r.isOpen ? '' : 'closed'}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.isOpen ? t('ochiq') : t('yopiq')}`}
      onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
      <div className="sres-photo"><RestaurantPhoto name={r.name} url={r.imageUrl} width={160} /></div>
      <div className="grow stack" style={{ gap: 3, minWidth: 0 }}>
        <div className="bold sres-name">{r.name}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${r.isOpen ? 'open' : 'closed'}`}>{stateText(r)}</span>
          {ratingText(r.rating) && <span className="rrate"><Icon as={Star} size={14} className="star on" />{ratingText(r.rating)}</span>}
        </div>
      </div>
    </div>
  );
});

/** A dish that matched: picture, name, where it is sold, the price at the first rate. Opens that restaurant's menu at the dish's category. */
const DishRow = memo(function DishRow({ d, pricing, go }: { d: SearchDish; pricing: PublicPricing; go: (r: Route) => void }) {
  const open = () => go({ name: 'menu', id: d.restaurantId, cat: d.categoryId ?? undefined });
  const price = referenceUnitPrice(d.priceSom, pricing);
  return (
    <div className={`card tap product sdish ${d.isAvailable ? '' : 'muted'}`} role="button" tabIndex={0} aria-label={`${d.name}, ${d.restaurantName}`}
      onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}>
      {d.imageUrl
        ? <img className="img" src={mediaUrl(d.imageUrl, 160) ?? ''} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        : <div className="img" aria-hidden><Icon as={UtensilsCrossed} size={26} /></div>}
      <div className="grow stack" style={{ gap: 3, minWidth: 0 }}>
        <div className="bold">{d.name}</div>
        <div className="sub small sdish-where">{d.restaurantName}</div>
        <div className="row between" style={{ marginTop: 'auto', gap: 8 }}>
          <PriceTag unitSom={price} referenceSom={price} />
          {!d.isAvailable ? <span className="badge closed">{t('Mavjud emas')}</span> : !d.isOpen ? <span className="badge closed">{stateText(d)}</span> : null}
        </div>
      </div>
    </div>
  );
});

export function Home({ go }: { go: (r: Route) => void }) {
  const [text, setText] = useState(rememberedSearch);
  const [q, setQ] = useState(rememberedSearch.trim());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    rememberedSearch = text;
    const timer = window.setTimeout(() => startTransition(() => setQ(text.trim())), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const searching = q.length >= MIN_CHARS;
  // The restaurant list is always there (one request); a search is one more request that replaces a stale one (useLoad aborts it) and keeps the old answer on screen meanwhile.
  const list = useLoad(signal => api.restaurants('', signal), []);
  const found = useLoad(signal => (searching ? searchCached(q, signal) : Promise.resolve(null)), [q, searching]);
  const answer = searching ? found.data : null;
  const waiting = searching && found.loading;
  const clear = () => { setText(''); setQ(''); input.current?.focus(); };

  return (
    <div className="page">
      <BannerCarousel go={go} />
      <div className="searchbox">
        <Icon as={Search} size={20} className="searchbox-icon" />
        <input ref={input} className="searchbox-input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={60}
          placeholder={t('Taom yoki restoran qidirish')} aria-label={t('Taom yoki restoran qidirish')} value={text} onChange={e => setText(e.target.value)} />
        {text && <button type="button" className="searchbox-clear" onClick={clear} aria-label={t('Tozalash')}><Icon as={X} size={18} /></button>}
      </div>

      {!searching && (
        <>
          {text.trim().length > 0 && <div className="sub small searchhint">{t('Kamida 2 ta harf yozing')}</div>}
          {list.loading && !list.data && <Skeletons />}
          {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
          {list.data && list.data.restaurants.length === 0 && <Empty icon={<Icon as={Search} size={44} />} title={t('Hozircha restoranlar yo‘q')} hint={t('Keyinroq qaytib keling.')} />}
          {list.data && list.data.restaurants.length > 0 && <div className="rgrid">{list.data.restaurants.map(r => <RestaurantCard key={r.id} r={r} go={go} />)}</div>}
        </>
      )}

      {searching && (
        <div className={`stack sresults ${waiting ? 'waiting' : ''}`} aria-busy={waiting}>
          {found.error && <ErrorBox error={found.error} onRetry={found.reload} />}
          {waiting && !answer && <Skeletons n={3} />}
          {answer && answer.restaurants.length === 0 && answer.dishes.length === 0 && (
            <Empty icon={<Icon as={Search} size={44} />} title={t('Hech narsa topilmadi')} hint={t('Boshqa so‘z bilan qidirib ko‘ring.')} />
          )}
          {answer && answer.restaurants.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="sec-title">{t('Restoranlar')}</h2>
              {answer.restaurants.map(r => <RestaurantRow key={r.id} r={r} go={go} />)}
            </section>
          )}
          {answer && answer.dishes.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="sec-title">{t('Taomlar')}</h2>
              {answer.dishes.map(d => <DishRow key={d.id} d={d} pricing={answer.pricing ?? FLAT_PRICING} go={go} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
