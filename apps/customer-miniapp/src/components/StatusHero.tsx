import { CreditCard, ChefHat, Car, Footprints, PackageCheck, XCircle, LifeBuoy, Hourglass, Check, type LucideIcon } from 'lucide-react';
import { Icon } from './ui';
import { heroSteps, type HeroKey } from '../lib/order';
import type { CustomerStage } from '../lib/types';

const STEP_ICON: Record<HeroKey, LucideIcon> = { PAY: CreditCard, COOK: ChefHat, ROAD: Car };

const HEADLINE: Record<CustomerStage, string> = {
  PAYMENT_PENDING: 'To‘lov kutilmoqda',
  PAYMENT_CHECKING: 'To‘lov tekshirilmoqda',
  PREPARING: 'Tayyorlanmoqda',
  READY: 'Taom tayyor',
  SELF_DELIVERY: 'Restoran o‘zi olib bormoqda',
  TAXI_REQUESTED: 'Haydovchi qidirilmoqda',
  TAXI_ACCEPTED: 'Haydovchi qidirilmoqda',
  TAXI_SENT: 'Buyurtmangiz yo‘lda',
  DELIVERED: 'Yetkazildi',
  CANCELLATION_REQUESTED: 'Bekor qilish so‘ralgan',
  CANCELLED: 'Bekor qilingan',
  EXPIRED: 'To‘lov vaqti tugadi',
  NEEDS_HELP: 'Yordam kerak',
};

const BIG_ICON: Record<CustomerStage, LucideIcon> = {
  PAYMENT_PENDING: CreditCard, PAYMENT_CHECKING: Hourglass, PREPARING: ChefHat, READY: ChefHat, SELF_DELIVERY: Footprints, TAXI_REQUESTED: Car, TAXI_ACCEPTED: Car,
  TAXI_SENT: Car, DELIVERED: PackageCheck, CANCELLATION_REQUESTED: Hourglass, CANCELLED: XCircle, EXPIRED: XCircle, NEEDS_HELP: LifeBuoy,
};

export function StatusHero({ stage, cash = false }: { stage: CustomerStage; cash?: boolean }) {
  const steps = heroSteps(stage)?.map(p => (cash && p.key === 'PAY' ? { ...p, label: 'Tasdiq' } : p)) ?? null;
  const bad = stage === 'CANCELLED' || stage === 'EXPIRED' || stage === 'NEEDS_HELP';
  return (
    <div className="hero" aria-live="polite">
      <div className={`hero-ico ${bad ? 'bad' : stage === 'DELIVERED' ? 'done' : ''}`} aria-hidden><Icon as={BIG_ICON[stage]} size={56} /></div>
      <div className="hero-title">{cash && stage === 'PAYMENT_PENDING' ? 'Restoran tasdiqlashini kutmoqda' : HEADLINE[stage]}</div>
      {steps && (
        <ol className="phases" aria-label="Buyurtma bosqichlari">
          {steps.map(p => (
            <li key={p.key} className={`phase ${p.state}`} aria-current={p.state === 'current' ? 'step' : undefined}>
              <span className="phase-dot" aria-hidden><Icon as={p.state === 'done' ? Check : STEP_ICON[p.key]} size={20} /></span>
              <span className="phase-label">{p.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
