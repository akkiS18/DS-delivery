import { CreditCard, ChefHat, Car, Footprints, PackageCheck, ShoppingBag, XCircle, MessageCircle, Hourglass, Check, type LucideIcon } from 'lucide-react';
import { Icon } from './ui';
import { heroSteps, type HeroKey } from '../lib/order';
import type { CustomerStage } from '../lib/types';
import { t, T } from '../i18n';

const STEP_ICON: Record<HeroKey, LucideIcon> = { PAY: CreditCard, COOK: ChefHat, ROAD: Car };
const PICKUP_STEP_ICON: Record<HeroKey, LucideIcon> = { PAY: CreditCard, COOK: ChefHat, ROAD: ShoppingBag };

const HEADLINE: Record<CustomerStage, string> = {
  PAYMENT_PENDING: T('To‘lov kutilmoqda'),
  PAYMENT_CHECKING: T('To‘lov tekshirilmoqda'),
  PREPARING: T('Tayyorlanmoqda'),
  READY: T('Taom tayyor'),
  SELF_DELIVERY: T('Restoran o‘zi olib bormoqda'),
  PICKUP_READY: T('Tayyor — restorandan olib keting'),
  TAXI_REQUESTED: T('Haydovchi qidirilmoqda'),
  TAXI_ACCEPTED: T('Haydovchi qidirilmoqda'),
  TAXI_SENT: T('Buyurtmangiz yo‘lda'),
  DELIVERED: T('Yetkazildi'),
  CANCELLATION_REQUESTED: T('Bekor qilish so‘ralgan'),
  CANCELLED: T('Bekor qilingan'),
  EXPIRED: T('To‘lov vaqti tugadi'),
  NEEDS_HELP: T('Yordam kerak'),
};

const BIG_ICON: Record<CustomerStage, LucideIcon> = {
  PAYMENT_PENDING: CreditCard, PAYMENT_CHECKING: Hourglass, PREPARING: ChefHat, READY: ChefHat, SELF_DELIVERY: Footprints, PICKUP_READY: ShoppingBag, TAXI_REQUESTED: Car, TAXI_ACCEPTED: Car,
  TAXI_SENT: Car, DELIVERED: PackageCheck, CANCELLATION_REQUESTED: Hourglass, CANCELLED: XCircle, EXPIRED: XCircle, NEEDS_HELP: MessageCircle,
};

/** pickup = "O‘zim olib ketaman": the last step is the customer collecting the order, not a delivery. */
export function StatusHero({ stage, cash = false, pickup = false }: { stage: CustomerStage; cash?: boolean; pickup?: boolean }) {
  const steps = heroSteps(stage, pickup)?.map(p => (cash && p.key === 'PAY' ? { ...p, label: t('Tasdiq') } : p)) ?? null;
  const stepIcon = pickup ? PICKUP_STEP_ICON : STEP_ICON;
  const bad = stage === 'CANCELLED' || stage === 'EXPIRED' || stage === 'NEEDS_HELP';
  return (
    <div className="hero" aria-live="polite">
      <div className={`hero-ico ${bad ? 'bad' : stage === 'DELIVERED' ? 'done' : ''}`} aria-hidden><Icon as={BIG_ICON[stage]} size={56} /></div>
      <div className="hero-title">{cash && stage === 'PAYMENT_PENDING' ? t('Restoran tasdiqlashini kutmoqda') : cash && stage === 'EXPIRED' ? t('Restoran tasdiqlamadi') : pickup && stage === 'DELIVERED' ? t('Olib ketildi') : t(HEADLINE[stage])}</div>
      {steps && (
        <ol className="phases" aria-label={t('Buyurtma bosqichlari')}>
          {steps.map(p => (
            <li key={p.key} className={`phase ${p.state}`} aria-current={p.state === 'current' ? 'step' : undefined}>
              <span className="phase-dot" aria-hidden><Icon as={p.state === 'done' ? Check : stepIcon[p.key]} size={20} /></span>
              <span className="phase-label">{p.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
