import { CreditCard, ChefHat, Car, PackageCheck, XCircle, LifeBuoy, Hourglass, Check, type LucideIcon } from 'lucide-react';
import { Icon } from './ui';
import type { CustomerStage } from '../lib/types';

/** The four things a customer cares about, in order. Everything else (taxi booked, operator accepted...) lives inside one of them. */
type Phase = 'PAY' | 'COOK' | 'ROAD' | 'DONE';
const PHASES: Array<{ key: Phase; label: string; icon: LucideIcon }> = [
  { key: 'PAY', label: 'To‘lov', icon: CreditCard },
  { key: 'COOK', label: 'Tayyorlanmoqda', icon: ChefHat },
  { key: 'ROAD', label: 'Yo‘lda', icon: Car },
  { key: 'DONE', label: 'Yetkazildi', icon: PackageCheck },
];

const PHASE_OF: Partial<Record<CustomerStage, Phase>> = {
  PAYMENT_PENDING: 'PAY', PAYMENT_CHECKING: 'PAY',
  PREPARING: 'COOK', READY: 'COOK', TAXI_REQUESTED: 'COOK', TAXI_ACCEPTED: 'COOK',
  TAXI_SENT: 'ROAD',
  DELIVERED: 'DONE',
};

const HEADLINE: Record<CustomerStage, string> = {
  PAYMENT_PENDING: 'To‘lov kutilmoqda',
  PAYMENT_CHECKING: 'To‘lov tekshirilmoqda',
  PREPARING: 'Tayyorlanmoqda',
  READY: 'Taom tayyor',
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
  PAYMENT_PENDING: CreditCard, PAYMENT_CHECKING: Hourglass, PREPARING: ChefHat, READY: ChefHat, TAXI_REQUESTED: Car, TAXI_ACCEPTED: Car,
  TAXI_SENT: Car, DELIVERED: PackageCheck, CANCELLATION_REQUESTED: Hourglass, CANCELLED: XCircle, EXPIRED: XCircle, NEEDS_HELP: LifeBuoy,
};

export function StatusHero({ stage }: { stage: CustomerStage }) {
  const phase = PHASE_OF[stage] ?? null;
  const at = phase ? PHASES.findIndex(p => p.key === phase) : -1;
  const bad = stage === 'CANCELLED' || stage === 'EXPIRED' || stage === 'NEEDS_HELP';
  return (
    <div className="hero" aria-live="polite">
      <div className={`hero-ico ${bad ? 'bad' : stage === 'DELIVERED' ? 'done' : ''}`} aria-hidden><Icon as={BIG_ICON[stage]} size={56} /></div>
      <div className="hero-title">{HEADLINE[stage]}</div>
      {phase && (
        <ol className="phases" aria-label="Buyurtma bosqichlari">
          {PHASES.map((p, i) => {
            const state = stage === 'DELIVERED' || i < at ? 'done' : i === at ? 'current' : 'todo';
            return (
              <li key={p.key} className={`phase ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="phase-dot" aria-hidden>{state === 'done' ? <Icon as={Check} size={20} /> : <Icon as={p.icon} size={20} />}</span>
                <span className="phase-label">{p.label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
