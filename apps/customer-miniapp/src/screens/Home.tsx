import { memo, startTransition, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Star, UtensilsCrossed, X } from 'lucide-react';
import { ActiveOrderStrip } from '../components/ActiveOrderStrip';
import { AddressChip } from '../components/AddressChip';
import { BannerCarousel } from '../components/BannerCarousel';
import { CottonPattern } from '../components/CottonPattern';
import { PriceTag } from '../components/FeeProgress';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { FLAT_PRICING, referenceUnitPrice } from '../lib/fee';
import { opensText } from '../lib/format';
import { splitMatch } from '../lib/highlight';
import { mediaUrl } from '../lib/platform';
import { ratingText } from '../lib/rating';
import { pushBackHandler } from '../lib/telegram';
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

/** The badge on a restaurant card. A restaurant that is switched off for now carries no text at all (owner 2026-11-07): its card is only greyed. */
const stateText = (r: { isOpen: boolean; closedReason: 'PAUSED' | 'HOURS' | null }) => (r.isOpen ? t('Ochiq') : r.closedReason === 'PAUSED' ? '' : t('Yopiq'));

/** Marks the letters of the search word inside a name. */
function Marked({ text, query }: { text: string; query: string }) {
  const p = splitMatch(text, query);
  if (!p.match) return <>{text}</>;
  return <>{p.before}<mark>{p.match}</mark>{p.after}</>;
}

/** An open restaurant: a big card, the photo filling its top. */
const RestaurantCard = memo(function RestaurantCard({ r, go }: { r: Restaurant; go: (r: Route) => void }) {
  return (
    <div className="card tap rcard" role="button" tabIndex={0} aria-label={`${r.name}, ${t('ochiq')}`}
      onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
      <div className="rphoto">
        <RestaurantPhoto name={r.name} url={r.imageUrl} />
        <span className="badge rstate open">{t('Ochiq')}</span>
        {ratingText(r.rating) && <span className="rrate-pill"><Icon as={Star} size={14} className="star on" />{ratingText(r.rating)}</span>}
      </div>
      <div className="rbody">
        <h3 className="rname">{r.name}</h3>
        {r.reservation && <div className="rtags"><span className="rtag">{t('Joy bron qilish mumkin')}</span></div>}
      </div>
    </div>
  );
});

/** A restaurant that is closed (or switched off for now): one quiet row under the open ones. */
const ClosedRow = memo(function ClosedRow({ r, go }: { r: Restaurant; go: (r: Route) => void }) {
  return (
    <div className="rclosed" role="button" tabIndex={0} aria-label={`${r.name}, ${t('yopiq')}`}
      onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
      <span className="rclosed-photo"><RestaurantPhoto name={r.name} url={r.imageUrl} width={160} /></span>
      <span className="rclosed-text">
        <span className="rclosed-name">{r.name}</span>
        <span className="rclosed-sub">{r.closedReason === 'HOURS' ? `${t('Yopiq')} • ${opensText(r.opensNext)}` : t('Hozir yopiq')}</span>
      </span>
      <Icon as={ChevronRight} size={20} className="rclosed-chev" />
    </div>
  );
});

/** A restaurant that matched the search: one compact row. */
const RestaurantRow = memo(function RestaurantRow({ r, q, go }: { r: Restaurant; q: string; go: (r: Route) => void }) {
  return (
    <div className={`srow ${r.isOpen ? '' : 'closed'}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.isOpen ? t('ochiq') : t('yopiq')}`}
      onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
      <span className="srow-photo"><RestaurantPhoto name={r.name} url={r.imageUrl} width={160} /></span>
      <span className="srow-text">
        <span className="srow-name"><Marked text={r.name} query={q} /></span>
        <span className="srow-sub">
          {stateText(r) || t('Hozir yopiq')}
          {ratingText(r.rating) && <> • <Icon as={Star} size={13} className="star on" />{ratingText(r.rating)}</>}
        </span>
      </span>
      <Icon as={ChevronRight} size={20} className="srow-chev" />
    </div>
  );
});

/** A dish that matched: picture, name (the typed letters marked), where it is sold, the price at the first rate. Opens that restaurant's menu at the dish's category. */
const DishRow = memo(function DishRow({ d, q, pricing, go }: { d: SearchDish; q: string; pricing: PublicPricing; go: (r: Route) => void }) {
  const open = () => go({ name: 'menu', id: d.restaurantId, cat: d.categoryId ?? undefined });
  const price = referenceUnitPrice(d.priceSom, pricing);
  return (
    <div className={`srow ${d.isAvailable ? '' : 'closed'}`} role="button" tabIndex={0} aria-label={`${d.name}, ${d.restaurantName}`}
      onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}>
      <span className="srow-photo">
        {d.imageUrl
          ? <img src={mediaUrl(d.imageUrl, 160) ?? ''} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          : <Icon as={UtensilsCrossed} size={22} />}
      </span>
      <span className="srow-text">
        <span className="srow-name"><Marked text={d.name} query={q} /></span>
        <span className="srow-sub">{d.restaurantName}{!d.isAvailable ? ` • ${t('Mavjud emas')}` : !d.isOpen ? ` • ${stateText(d) || t('Hozir yopiq')}` : ''}</span>
      </span>
      <PriceTag unitSom={price} referenceSom={price} />
    </div>
  );
});

export function Home({ go }: { go: (r: Route) => void }) {
  const [text, setText] = useState(rememberedSearch);
  const [q, setQ] = useState(rememberedSearch.trim());
  // The search takes the whole screen (the mockup's search view): from the moment the field is tapped until the back arrow.
  const [active, setActive] = useState(rememberedSearch.length > 0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    rememberedSearch = text;
    const timer = window.setTimeout(() => startTransition(() => setQ(text.trim())), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const closeSearch = () => { setText(''); setQ(''); setActive(false); input.current?.blur(); };
  useEffect(() => (active ? pushBackHandler(closeSearch) : undefined), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = q.length >= MIN_CHARS;
  // The restaurant list is always there (one request); a search is one more request that replaces a stale one (useLoad aborts it) and keeps the old answer on screen meanwhile.
  const list = useLoad(signal => api.restaurants('', signal), []);
  const found = useLoad(signal => (searching ? searchCached(q, signal) : Promise.resolve(null)), [q, searching]);
  const answer = searching ? found.data : null;
  const waiting = searching && found.loading;
  const clear = () => { setText(''); setQ(''); input.current?.focus(); };

  const open = list.data?.restaurants.filter(r => r.isOpen) ?? [];
  const closed = list.data?.restaurants.filter(r => !r.isOpen) ?? [];

  return (
    <>
      <header className={`home-head ${active ? 'searching' : ''}`}>
        {!active && <CottonPattern key="cotton" id="cottonHome" />}
        {!active && <AddressChip key="addr" go={go} />}
        {!active && <h1 key="title" className="home-title">{t('Bugun nima yeymiz?')}</h1>}
        {active && <button key="back" type="button" className="round-back" onClick={closeSearch} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>}
        <div key="box" className="searchbox">
          <Icon as={Search} size={20} className="searchbox-icon" />
          <input ref={input} className="searchbox-input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={60}
            placeholder={t('Taom yoki restoran qidirish')} aria-label={t('Taom yoki restoran qidirish')} value={text} onFocus={() => setActive(true)} onChange={e => setText(e.target.value)} />
          {/* preventDefault on pointer down: the tap must not take focus from the field, or the keyboard stays up while the app thinks it closed. */}
          {text && <button type="button" className="searchbox-clear" onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={clear} aria-label={t('Tozalash')}><Icon as={X} size={18} /></button>}
        </div>
      </header>
      <div className="page">
      {!active && <ActiveOrderStrip go={go} />}
      {!active && <BannerCarousel go={go} />}

      {!active && (
        <>
          {list.loading && !list.data && <Skeletons />}
          {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
          {list.data && list.data.restaurants.length === 0 && <Empty icon={<Icon as={Search} size={44} />} title={t('Hozircha restoranlar yo‘q')} hint={t('Keyinroq qaytib keling.')} />}
          {list.data && list.data.restaurants.length > 0 && (
            <section className="stack" style={{ gap: 12 }} aria-label={t('Restoranlar')}>
              <div className="row between sec-row"><h2 className="sec-title">{t('Restoranlar')}</h2>{open.length > 0 && <span className="sec-note">{t('{n} tasi hozir ochiq', { n: open.length })}</span>}</div>
              {open.map(r => <RestaurantCard key={r.id} r={r} go={go} />)}
              {closed.map(r => <ClosedRow key={r.id} r={r} go={go} />)}
            </section>
          )}
        </>
      )}

      {active && !searching && <div className="sub small searchhint">{t('Kamida 2 ta harf yozing')}</div>}

      {active && searching && (
        <div className={`stack sresults ${waiting ? 'waiting' : ''}`} aria-busy={waiting}>
          {found.error && <ErrorBox error={found.error} onRetry={found.reload} />}
          {waiting && !answer && <Skeletons n={3} />}
          {answer && answer.restaurants.length === 0 && answer.dishes.length === 0 && (
            <Empty icon={<Icon as={Search} size={44} />} title={t('Hech narsa topilmadi')} hint={t('Boshqa so‘z bilan qidirib ko‘ring.')} />
          )}
          {answer && answer.dishes.length > 0 && (
            <section className="stack" style={{ gap: 0 }}>
              <h2 className="sec-cap">{t('Taomlar · {n}', { n: answer.dishes.length })}</h2>
              {answer.dishes.map(d => <DishRow key={d.id} d={d} q={q} pricing={answer.pricing ?? FLAT_PRICING} go={go} />)}
            </section>
          )}
          {answer && answer.restaurants.length > 0 && (
            <section className="stack" style={{ gap: 0 }}>
              <h2 className="sec-cap">{t('Restoranlar · {n}', { n: answer.restaurants.length })}</h2>
              {answer.restaurants.map(r => <RestaurantRow key={r.id} r={r} q={q} go={go} />)}
            </section>
          )}
        </div>
      )}
      </div>
    </>
  );
}
