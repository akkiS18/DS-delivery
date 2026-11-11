import { ChefHat, ChevronRight } from 'lucide-react';
import { Icon } from './ui';
import { api } from '../lib/api';
import { heroSteps, STAGE_LABEL } from '../lib/order';
import { groupOrders } from '../lib/orderList';
import type { Route } from '../lib/router';
import { useLoad } from '../state';
import { t } from '../i18n';

/**
 * Home: the order that is on its way, as one dark strip above the offers (a quiet failure shows nothing). One active order opens its tracking
 * screen; several open the list. The three segments follow the order's real steps (payment, kitchen, road), the current one included.
 */
export function ActiveOrderStrip({ go }: { go: (r: Route) => void }) {
  const orders = useLoad(signal => api.orders(signal), []);
  const active = orders.data ? groupOrders(orders.data.orders).active : [];
  const first = active[0];
  if (!first) return null;
  const steps = heroSteps(first.stage);
  const open = () => go(active.length === 1 ? { name: 'order', id: first.id } : { name: 'orders' });
  return (
    <button type="button" className="live-strip" onClick={open}
      aria-label={t('Buyurtma {code}, {name}, {stage}', { code: first.code, name: first.restaurantName, stage: t(STAGE_LABEL[first.stage]) })}>
      <span className="live-strip-ico" aria-hidden><Icon as={ChefHat} size={24} /></span>
      <span className="live-strip-body">
        <span className="live-strip-top">#{first.code} • {first.restaurantName}{active.length > 1 ? ` • +${active.length - 1}` : ''}</span>
        <span className="live-strip-stage">{t(STAGE_LABEL[first.stage])}</span>
        {steps && (
          <span className="live-strip-steps" aria-hidden>
            {steps.map(s => <span key={s.key} className={s.state === 'todo' ? '' : 'on'} />)}
          </span>
        )}
      </span>
      <Icon as={ChevronRight} size={22} />
    </button>
  );
}
