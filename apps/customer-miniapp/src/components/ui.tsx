import { AlertTriangle, Home, MessageCircle, ReceiptText, Minus, Plus, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../lib/api';
import { describeCheckoutError } from '../lib/checkoutErrors';
import { haptic, pushBackHandler } from '../lib/telegram';
import type { Route } from '../lib/router';
import { t } from '../i18n';

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

export const Spinner = () => <div className="spinner" role="progressbar" aria-label={t('Yuklanmoqda')} />;
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
      <p>{d.kind === 'OTHER' && error?.status === 404 ? t('Topilmadi.') : d.kind === 'NETWORK' ? t('Internet aloqasi yo‘q yoki server javob bermadi. Aloqani tekshirib, qayta urinib ko‘ring.') : d.message}</p>
      {onRetry && d.kind !== 'AUTH' && <Button variant="secondary" onClick={onRetry}>{t('Qayta urinish')}</Button>}
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

/**
 * The screen's next-step button, pinned above the tab bar so it is always in sight (a button at the end of a long page goes unnoticed).
 * Publishes its height as --cartbar-h (like the basket bar, which is hidden on these screens) so the page keeps its last lines reachable.
 */
export function StickyAction({ hint, tone = 'soft', children }: { hint?: ReactNode; tone?: 'soft' | 'bad'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) return;
    const publish = () => root.style.setProperty('--cartbar-h', `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--cartbar-h');
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--cartbar-h'); };
  }, []);
  return (
    <div className="cartfloat actionbar" ref={ref}>
      {hint ? <p className={`actionhint ${tone === 'bad' ? 'bad' : ''}`} role={tone === 'bad' ? 'alert' : undefined}>{hint}</p> : null}
      {children}
    </div>
  );
}

export function Qty({ value, onInc, onDec, max = 30 }: { value: number; onInc: () => void; onDec: () => void; max?: number }) {
  return (
    <div className="qty" role="group" aria-label={t('Miqdor')}>
      <button type="button" aria-label={t('Kamaytirish')} onClick={() => { haptic.tap(); onDec(); }}><Icon as={Minus} size={20} /></button>
      <span className="mono" aria-live="polite">{value}</span>
      <button type="button" aria-label={t('Ko‘paytirish')} disabled={value >= max} onClick={() => { haptic.tap(); onInc(); }}><Icon as={Plus} size={20} /></button>
    </div>
  );
}

/** Four tabs; the basket has no tab of its own: it opens from the floating basket panel (CartBar), and its screens keep "Asosiy" lit. */
export function TabBar({ route, go, orders, support = 0 }: { route: Route; go: (r: Route) => void; orders: number; support?: number }) {
  const tabs: Array<{ r: Route; icon: LucideIcon; label: string; on: boolean; badge?: number }> = [
    { r: { name: 'home' }, icon: Home, label: t('Asosiy'), on: route.name === 'home' || route.name === 'menu' || route.name === 'reserve' || route.name === 'cart' || route.name === 'checkout' },
    { r: { name: 'orders' }, icon: ReceiptText, label: t('Buyurtma'), on: route.name === 'orders' || route.name === 'history' || route.name === 'order' || route.name === 'reservations' || route.name === 'reservation', ...(orders > 0 ? { badge: orders } : {}) },
    { r: { name: 'support' }, icon: MessageCircle, label: t('Yordam'), on: route.name === 'support' || route.name === 'ticket' || route.name === 'supportNew', ...(support > 0 ? { badge: support } : {}) },
    { r: { name: 'profile' }, icon: UserRound, label: t('Profil'), on: route.name === 'profile' },
  ];
  return (
    <div className="tabbar">
      <nav aria-label={t('Asosiy navigatsiya')}>
        {tabs.map(tab => (
          <button key={tab.r.name} className={tab.on ? 'on' : ''} onClick={() => go(tab.r)} aria-current={tab.on ? 'page' : undefined}>
            <span className="ico" aria-hidden><Icon as={tab.icon} size={24} />{tab.badge ? <span className="dot">{tab.badge}</span> : null}</span>
            <span className="lbl">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

