import { useMemo, useState } from 'react';
import { ChevronLeft, ReceiptText } from 'lucide-react';
import { PastOrderCard } from '../components/PastOrderCard';
import { Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { countThisMonth, groupByPeriod, matchesFilter, topRestaurant, type HistoryFilter } from '../lib/history';
import { groupOrders } from '../lib/orderList';
import type { Route } from '../lib/router';
import { useOrders } from '../lib/useOrders';
import { t } from '../i18n';

/** Finished orders on a screen of their own (the Buyurtma tab shows only what is still going on). */
export function History({ go }: { go: (r: Route) => void }) {
  const { data, error, refresh } = useOrders();
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const nowMs = useMemo(() => Date.now(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => (data ? groupOrders(data).history : []), [data]);
  const shown = useMemo(() => history.filter(o => matchesFilter(o.stage, filter)), [history, filter]);
  const groups = useMemo(() => groupByPeriod(shown, nowMs), [shown, nowMs]);

  const head = (
    <header className="screen-head">
      <button type="button" className="round-back" onClick={() => go({ name: 'orders' })} aria-label={t('Ortga')}><Icon as={ChevronLeft} size={22} /></button>
      <h1 className="grow">{t('Buyurtmalar tarixi')}</h1>
    </header>
  );
  if (!data && !error) return <>{head}<div className="page"><Skeletons n={4} /></div></>;
  if (!data) return <>{head}<div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div></>;

  const top = topRestaurant(history);
  const chips: Array<{ f: HistoryFilter; label: string }> = [
    { f: 'ALL', label: `${t('Hammasi')} • ${history.length}` },
    { f: 'DELIVERED', label: t('Yetkazildi') },
    { f: 'CANCELLED', label: t('Bekor qilingan') },
  ];
  return (
    <>
      {head}
      <div className="page" style={{ paddingTop: 4 }}>
        {history.length === 0
          ? <Empty icon={<Icon as={ReceiptText} size={44} />} title={t('Hali buyurtma yo‘q')} hint={t('Birinchi buyurtmangizni bering.')} />
          : (
            <>
              <div className="chips wrap" role="group" aria-label={t('Saralash')}>
                {chips.map(c => <button key={c.f} type="button" className={`chip ${filter === c.f ? 'on' : ''}`} aria-pressed={filter === c.f} onClick={() => setFilter(c.f)}>{c.label}</button>)}
              </div>
              <div className="hist-tiles">
                <div className="hist-tile dark"><span>{t('Shu oyda')}</span><b>{t('{n} ta buyurtma', { n: countThisMonth(history, nowMs) })}</b></div>
                {top && <div className="hist-tile"><span>{t('Eng ko‘p')}</span><b>{top}</b></div>}
              </div>
              {error && <div className="banner warn" role="status">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}
              {groups.map(g => (
                <section key={g.key} className="stack" aria-label={g.label}>
                  <h2 className="period">{g.label}</h2>
                  {g.items.map(o => <PastOrderCard key={o.id} o={o} nowMs={nowMs} open={() => go({ name: 'order', id: o.id })} onRated={() => void refresh()} />)}
                </section>
              ))}
              {shown.length === 0 && <p className="sub center">{t('Bu bo‘limda buyurtma yo‘q')}</p>}
            </>
          )}
      </div>
    </>
  );
}
