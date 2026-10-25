import { Check } from 'lucide-react';
import { Button, Icon } from './ui';

/**
 * Shown once, the moment a payment becomes accepted: the customer must SEE that paying worked and cooking began.
 * It stays until the customer presses OK (no timer): a payment confirmation must not vanish while the phone is in a pocket.
 */
export function PaidDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-back paid-back" role="alertdialog" aria-modal="true" aria-labelledby="paid-title" aria-describedby="paid-text">
      <div className="paid-card">
        <span className="paid-check" aria-hidden><Icon as={Check} size={48} /></span>
        <h2 id="paid-title" className="paid-title">To‘lovingiz qabul qilindi</h2>
        <p id="paid-text" className="paid-text">Taom tayyorlanmoqda</p>
        <Button onClick={onClose}>OK</Button>
      </div>
    </div>
  );
}
