import type { Route } from '../lib/router';
import { t } from '../i18n';

/** The two lists under one tab: orders and table reservations. */
export function OrdersSwitch({ active, go }: { active: 'orders' | 'reservations'; go: (r: Route) => void }) {
  return (
    <div className="seg" role="tablist" aria-label={t('Buyurtmalarim')}>
      <button type="button" role="tab" aria-selected={active === 'orders'} className={active === 'orders' ? 'on' : ''} onClick={() => active !== 'orders' && go({ name: 'orders' })}>{t('Buyurtmalar')}</button>
      <button type="button" role="tab" aria-selected={active === 'reservations'} className={active === 'reservations' ? 'on' : ''} onClick={() => active !== 'reservations' && go({ name: 'reservations' })}>{t('Bronlar')}</button>
    </div>
  );
}
