import { useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { opensText } from '../lib/format';
import { ratingText } from '../lib/rating';
import type { Route } from '../lib/router';
import { useLoad } from '../state';

/** Survives Home unmounting (menu -> back) so the customer returns to the same search. Cleared with the page, not persisted. */
let rememberedSearch = '';

export function Home({ go }: { go: (r: Route) => void }) {
  const [text, setText] = useState(rememberedSearch);
  const [q, setQ] = useState(rememberedSearch.trim());
  useEffect(() => { rememberedSearch = text; const t = window.setTimeout(() => setQ(text.trim()), 250); return () => window.clearTimeout(t); }, [text]);
  const { data, error, loading, reload } = useLoad(signal => api.restaurants(q, signal), [q]);

  return (
    <div className="page">
      <input className="input" type="search" inputMode="search" placeholder="Restoran qidirish" value={text} onChange={e => setText(e.target.value)} aria-label="Restoran qidirish" />
      {loading && !data && <Skeletons />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && data.restaurants.length === 0 && (
        <Empty icon={<Icon as={Search} size={44} />} title={q ? 'Hech narsa topilmadi' : 'Hozircha restoranlar yo‘q'} hint={q ? 'Boshqa nom bilan qidirib ko‘ring.' : 'Keyinroq qaytib keling.'} />
      )}
      {data?.restaurants.map(r => (
        <div key={r.id} className={`card tap rcard ${r.isOpen ? '' : 'closed'}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.isOpen ? 'ochiq' : 'yopiq'}`}
          onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
          <div className="rphoto">
            <RestaurantPhoto name={r.name} url={r.imageUrl} />
            <span className={`badge rstate ${r.isOpen ? 'open' : 'closed'}`}>{r.isOpen ? 'Ochiq' : r.closedReason === 'PAUSED' ? 'Vaqtincha yopiq' : 'Yopiq'}</span>
          </div>
          <div className="rbody">
            <h3 className="rname">{r.name}</h3>
            <div className="rmeta">
              {ratingText(r.rating) && <span className="rrate"><Icon as={Star} size={16} className="star on" />{ratingText(r.rating)}</span>}
              {!r.isOpen && <span className="sub">{r.closedReason === 'HOURS' ? opensText(r.opensNext) : 'Hozircha buyurtma qabul qilmaydi'}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
