import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { api } from '../lib/api';
import { opensText } from '../lib/format';
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
        <div key={r.id} className={`card tap ${r.isOpen ? '' : 'muted'}`} role="button" tabIndex={0}
          onClick={() => go({ name: 'menu', id: r.id })} onKeyDown={e => { if (e.key === 'Enter') go({ name: 'menu', id: r.id }); }}>
          <div className="row between">
            <h3 className="grow ellipsis">{r.name}</h3>
            <span className={`badge ${r.isOpen ? 'open' : 'closed'}`}>{r.isOpen ? 'Ochiq' : r.closedReason === 'PAUSED' ? 'Vaqtincha yopiq' : 'Yopiq'}</span>
          </div>
          <p className="sub small" style={{ marginTop: 4 }}>
            {r.isOpen ? `Tayyorlash ~${r.prepMinutes} daqiqa` : r.closedReason === 'HOURS' ? opensText(r.opensNext) : 'Hozircha buyurtma qabul qilmaydi'}
          </p>
        </div>
      ))}
    </div>
  );
}
