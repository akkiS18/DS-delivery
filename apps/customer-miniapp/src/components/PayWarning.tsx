import { TriangleAlert } from 'lucide-react';
import { mmss, som } from '../lib/format';
import { Icon } from './ui';

/**
 * The yellow notice above the card the customer must pay to: how long the payment window is, that the amount must be exactly this one,
 * and a countdown that runs backwards (like the cooking timer in the restaurant app). `remaining` is computed from the server's clock.
 */
export function PayWarning({ amountSom, windowMinutes, remaining, total }: { amountSom: number; windowMinutes: number; remaining: number | null; total: number | null }) {
  const over = remaining !== null && remaining <= 0;
  const urgent = remaining !== null && remaining > 0 && remaining <= 60;
  const share = remaining !== null && total ? Math.min(1, Math.max(0, remaining / total)) : null;
  return (
    <div className={`pay-warn${over ? ' over' : urgent ? ' urgent' : ''}`} role="alert">
      <div className="pay-warn-head">
        <Icon as={TriangleAlert} size={22} className="shrink" />
        <strong>
          {over
            ? 'To‘lov muddati tugadi. Pul o‘tkazmang.'
            : <>{windowMinutes} daqiqa ichida mana shu kartaga aynan <span className="nowrap">{som(amountSom)}</span> to‘lov qiling.</>}
        </strong>
      </div>
      {remaining !== null && !over && (
        <>
          <div className="pay-warn-time" aria-live="off"><span className="mono">{mmss(remaining)}</span><span className="pay-warn-left"> qoldi</span></div>
          {share !== null && <div className="pay-warn-bar" aria-hidden><span style={{ width: `${share * 100}%` }} /></div>}
        </>
      )}
      {!over && <div className="pay-warn-note">Boshqa summa yoki muddatdan keyin o‘tkazilgan pul avtomatik tasdiqlanmaydi.</div>}
    </div>
  );
}
