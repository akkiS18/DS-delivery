import type { KeyboardEvent } from 'react';
import { AlertTriangle, CarFront, ChefHat, ChevronRight, Clock3, CreditCard, Footprints, History, MessageCircle, PackageCheck, ReceiptText, type LucideIcon } from 'lucide-react';
import { OrdersSwitch } from '../components/OrdersSwitch';
import { Button, Empty, ErrorBox, Icon, Skeletons } from '../components/ui';
import { clock, som } from '../lib/format';
import { heroSteps, STAGE_LABEL } from '../lib/order';
import { groupOrders, needsAttention, nextAction } from '../lib/orderList';
import type { Route } from '../lib/router';
import type { CustomerStage, OrderSummary } from '../lib/types';
import { useOrders } from '../lib/useOrders';
import { t } from '../i18n';

const STAGE_ICON: Record<CustomerStage, LucideIcon> = {
  PAYMENT_PENDING: CreditCard, PAYMENT_CHECKING: Clock3, PREPARING: ChefHat, READY: PackageCheck, SELF_DELIVERY: Footprints, TAXI_REQUESTED: CarFront,
  TAXI_ACCEPTED: CarFront, TAXI_SENT: CarFront, DELIVERED: PackageCheck, CANCELLATION_REQUESTED: Clock3, CANCELLED: AlertTriangle,
  EXPIRED: AlertTriangle, NEEDS_HELP: AlertTriangle,
};

/** The Buyurtma tab: what is still going on. Finished orders are one tap away on their own screen (Tarix). */
export function Orders({ go }: { go: (r: Route) => void }) {
  const { data, error, refresh } = useOrders();
  const head = (
    <header className="page-head">
      <h1>{t('Buyurtmalarim')}</h1>
      <OrdersSwitch active="orders" go={go} />
    </header>
  );
  if (!data && !error) return <>{head}<div className="page"><Skeletons n={4} /></div></>;
  if (!data) return <>{head}<div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div></>;
  const { active, history } = groupOrders(data);
  const open = (o: OrderSummary) => go({ name: 'order', id: o.id });
  const key = (o: OrderSummary) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(o); } };

  // A payment waiting for the customer is yellow (like the notice on the payment screen); everything else that is going on is dark with its progress.
  const activeCard = (o: OrderSummary) => {
    const taxi = o.stage.startsWith('TAXI_') && o.taxi?.companyName ? o.taxi.companyName : null;
    const attn = needsAttention(o.stage, o.method);
    const steps = attn ? null : heroSteps(o.stage);
    return (
      <div key={o.id} className={`ocard ${attn ? 'pay' : 'live'}`} role="button" tabIndex={0} onClick={() => open(o)} onKeyDown={key(o)}
        aria-label={t('Buyurtma {code}, {name}, {stage}', { code: o.code, name: o.restaurantName, stage: t(STAGE_LABEL[o.stage]) })}>
        <div className="ocard-head"><span className="ocard-name">#{o.code} • {o.restaurantName}</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>
        <div className="ocard-mid">
          <span className="ocard-stage"><span className="ocard-ico" aria-hidden><Icon as={STAGE_ICON[o.stage]} size={22} /></span><span>{t(STAGE_LABEL[o.stage])}</span></span>
          <span className="ocard-go">{nextAction(o.stage, o.method)}<Icon as={ChevronRight} size={18} /></span>
        </div>
        {taxi && <div className="ocard-sub">{taxi}</div>}
        <div className="ocard-sub">{clock(o.createdAt)} • {t('{n} ta', { n: o.itemsCount })}</div>
        {steps && <span className="live-strip-steps" aria-hidden>{steps.map(s => <span key={s.key} className={s.state === 'todo' ? '' : 'on'} />)}</span>}
      </div>
    );
  };

  return (
    <>
      {head}
      <div className="page" style={{ paddingTop: 4 }}>
        <button type="button" className="helpbar" onClick={() => go({ name: 'support' })}><Icon as={MessageCircle} size={18} /><span>{t('Muammo yoki savol bormi? Yordamga yozing')}</span><Icon as={ChevronRight} size={18} /></button>
        {error && <div className="banner warn" role="status">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}
        {data.length === 0 && <Empty icon={<Icon as={ReceiptText} size={44} />} title={t('Hali buyurtma yo‘q')} hint={t('Birinchi buyurtmangizni bering.')} action={<Button onClick={() => go({ name: 'home' })}>{t('Restoranlar')}</Button>} />}
        {data.length > 0 && (
          <section className="stack" aria-label={t('Faol buyurtmalar')}>
            <h2 className="sec-title">{t('Faol buyurtmalar')}{active.length > 0 && <span className="count">{active.length}</span>}</h2>
            {active.length === 0
              ? <div className="card center stack"><p className="sub">{t('Hozir faol buyurtma yo‘q.')}</p><Button variant="secondary" onClick={() => go({ name: 'home' })}>{t('Restoranlar')}</Button></div>
              : active.map(activeCard)}
          </section>
        )}
        {history.length > 0 && (
          <button type="button" className="histbtn" onClick={() => go({ name: 'history' })}>
            <span className="histbtn-ico" aria-hidden><Icon as={History} size={22} /></span>
            <span className="histbtn-body"><span className="histbtn-title">{t('Tarixni ko‘rish')}</span><span className="sub small">{t('{n} ta oldingi buyurtma', { n: history.length })}</span></span>
            <Icon as={ChevronRight} size={20} />
          </button>
        )}
      </div>
    </>
  );
}
