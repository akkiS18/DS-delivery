import { useEffect } from 'react';
import { Check } from 'lucide-react';
import { Button, Icon } from './ui';

/** How long the "payment accepted" notice stays if the customer does not press OK. */
export const PAID_DIALOG_MS = 5000;

/**
 * Shown once, the moment a payment becomes accepted: the customer must SEE that paying worked and cooking began.
 * OK closes it; otherwise a ring runs around the check mark for five seconds and closes it by itself.
 */
export function PaidDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, PAID_DIALOG_MS);
    return () => window.clearTimeout(t);
  }, [onClose]);

  return (
    <div className="sheet-back paid-back" role="alertdialog" aria-modal="true" aria-labelledby="paid-title" aria-describedby="paid-text">
      <div className="paid-card">
        <div className="paid-ring" aria-hidden>
          <svg viewBox="0 0 100 100" width="112" height="112">
            <circle className="paid-ring-bg" cx="50" cy="50" r="44" />
            <circle className="paid-ring-run" cx="50" cy="50" r="44" style={{ animationDuration: `${PAID_DIALOG_MS}ms` }} />
          </svg>
          <span className="paid-check"><Icon as={Check} size={48} /></span>
        </div>
        <h2 id="paid-title" className="paid-title">To‘lovingiz qabul qilindi</h2>
        <p id="paid-text" className="paid-text">Taom tayyorlanmoqda</p>
        <Button onClick={onClose}>OK</Button>
      </div>
    </div>
  );
}
