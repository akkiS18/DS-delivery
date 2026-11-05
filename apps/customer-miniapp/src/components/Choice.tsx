import { Check, ChevronDown, Car, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { haptic } from '../lib/telegram';
import { t } from '../i18n';
import { Icon } from './ui';

/** A small, quiet "show more" line: the extra explanations live inside and open only when the customer taps it. */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="fold">
      <summary><span>{title}</span><Icon as={ChevronDown} size={16} className="fold-chev" /></summary>
      <div className="fold-body stack">{children}</div>
    </details>
  );
}

/** A square choice (payment method, walking delivery): icon on top, short title, one line under it. */
export function Tile({ icon, title, sub, on, onPick }: { icon: LucideIcon; title: string; sub?: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`tile ${on ? 'on' : ''}`} onClick={() => { haptic.tap(); onPick(); }}>
      {on && <span className="tile-check" aria-hidden><Icon as={Check} size={14} /></span>}
      <span className="tile-ico" aria-hidden><Icon as={icon} size={30} /></span>
      <span className="tile-title">{title}</span>
      {sub ? <span className="tile-sub">{sub}</span> : null}
    </button>
  );
}

/** A taxi service as a classic taxi card (yellow, checker strip). `number` is its short call number, shown for information only. */
export function TaxiTile({ name, number, on, onPick }: { name: string; number?: string | null; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`tile taxi ${on ? 'on' : ''}`} onClick={() => { haptic.tap(); onPick(); }}>
      {on && <span className="tile-check" aria-hidden><Icon as={Check} size={14} /></span>}
      <span className="tile-ico" aria-hidden><Icon as={Car} size={30} /></span>
      <span className="tile-title">{name}</span>
      {number ? <span className="taxi-number mono">{number}</span> : null}
      <span className="tile-sub">{t('narxi alohida')}</span>
    </button>
  );
}
