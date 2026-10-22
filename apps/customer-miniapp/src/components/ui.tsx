import { AlertTriangle, ReceiptText, Minus, Plus, UserRound, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../lib/api';
import { describeCheckoutError } from '../lib/checkoutErrors';
import { haptic, pushBackHandler } from '../lib/telegram';
import type { Route } from '../lib/router';

export function Button({ variant = 'primary', loading, children, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; small?: boolean }) {
  const { small, ...dom } = rest as typeof rest & { small?: boolean };
  return (
    <button {...dom} className={`btn ${variant === 'primary' ? '' : variant} ${small ? 'small' : ''}`} disabled={rest.disabled || loading}
      onClick={e => { haptic.tap(); onClick?.(e); }} aria-busy={loading || undefined}>
      {loading ? <span className="spinner" style={{ width: 20, height: 20, margin: 0, borderWidth: 2 }} /> : children}
    </button>
  );
}

/** One place for icon sizing so every icon shares the same stroke, size and alignment. */
export function Icon({ as: Glyph, size = 20, ...rest }: { as: LucideIcon; size?: number; className?: string }) {
  return <Glyph size={size} strokeWidth={2} absoluteStrokeWidth aria-hidden focusable={false} className={`icon ${rest.className ?? ''}`} />;
}

export const Spinner = () => <div className="spinner" role="progressbar" aria-label="Yuklanmoqda" />;
export const Skeletons = ({ n = 4 }: { n?: number }) => <div className="stack">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />)}</div>;

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden>{icon}</div>
      <h3 style={{ marginTop: 8, color: 'var(--ink)' }}>{title}</h3>
      {hint && <p className="sub" style={{ marginTop: 4 }}>{hint}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const d = describeCheckoutError(error);
  return (
    <div className="card center stack" role="alert">
      <div className="status-ico bad" aria-hidden><Icon as={AlertTriangle} size={32} /></div>
      <p>{d.kind === 'OTHER' && error?.status === 404 ? 'Topilmadi.' : d.message}</p>
      {onRetry && d.kind !== 'AUTH' && <Button variant="secondary" onClick={onRetry}>Qayta urinish</Button>}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const offBack = pushBackHandler(onClose); // Android back button closes the sheet before leaving the screen
    return () => { window.removeEventListener('keydown', onKey); offBack(); };
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Qty({ value, onInc, onDec, max = 30 }: { value: number; onInc: () => void; onDec: () => void; max?: number }) {
  return (
    <div className="qty" role="group" aria-label="Miqdor">
      <button type="button" aria-label="Kamaytirish" onClick={() => { haptic.tap(); onDec(); }}><Icon as={Minus} size={20} /></button>
      <span className="mono" aria-live="polite">{value}</span>
      <button type="button" aria-label="Ko‘paytirish" disabled={value >= max} onClick={() => { haptic.tap(); onInc(); }}><Icon as={Plus} size={20} /></button>
    </div>
  );
}

export function TabBar({ route, go, orders }: { route: Route; go: (r: Route) => void; orders: number }) {
  const tabs: Array<{ r: Route; icon: LucideIcon; label: string; on: boolean; badge?: number }> = [
    { r: { name: 'home' }, icon: UtensilsCrossed, label: 'Restoranlar', on: route.name === 'home' || route.name === 'menu' || route.name === 'cart' || route.name === 'checkout' },
    { r: { name: 'orders' }, icon: ReceiptText, label: 'Buyurtmalar', on: route.name === 'orders' || route.name === 'order', ...(orders > 0 ? { badge: orders } : {}) },
    { r: { name: 'profile' }, icon: UserRound, label: 'Profil', on: route.name === 'profile' },
  ];
  return (
    <div className="tabbar">
      <nav aria-label="Asosiy navigatsiya">
        {tabs.map(t => (
          <button key={t.r.name} className={t.on ? 'on' : ''} onClick={() => go(t.r)} aria-current={t.on ? 'page' : undefined}>
            <span className="ico" aria-hidden><Icon as={t.icon} size={24} />{t.badge ? <span className="dot">{t.badge}</span> : null}</span>
            <span className="lbl">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

