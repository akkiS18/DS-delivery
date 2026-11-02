import { TriangleAlert } from 'lucide-react';
import { mmss, som } from '../lib/format';
import { Icon } from './ui';
import { t, T } from '../i18n';
import { rich } from '../i18n/rich';

/**
 * The yellow notice above the card the customer must pay to: how long the payment window is, that the amount must be exactly this one,
 * and a countdown that runs backwards (like the cooking timer in the restaurant app). `remaining` is computed from the server's clock.
 */
export function PayWarning({ amountSom, windowMinutes, remaining, total, contactPhone }: { amountSom: number; windowMinutes: number; remaining: number | null; total: number | null; contactPhone?: string | null }) {
  const over = remaining !== null && remaining <= 0;
  const urgent = remaining !== null && remaining > 0 && remaining <= 60;
  const phone = contactPhone ? contactPhone.replace(/[^\d+]/g, '') : '';
  const share = remaining !== null && total ? Math.min(1, Math.max(0, remaining / total)) : null;
  return (
    <div className={`pay-warn${over ? ' over' : urgent ? ' urgent' : ''}`} role="alert">
      <div className="pay-warn-head">
        <Icon as={TriangleAlert} size={22} className="shrink" />
        <strong>
          {over
            ? t('To‘lov muddati tugadi. Pul o‘tkazmang.')
            : rich('{n} daqiqa ichida mana shu kartaga aynan {sum} to‘lov qiling.', { n: windowMinutes, sum: <span className="nowrap">{som(amountSom)}</span> })}
        </strong>
      </div>
      {remaining !== null && !over && (
        <>
          <div className="pay-warn-time" aria-live="off"><span className="mono">{mmss(remaining)}</span><span className="pay-warn-left"> {t('qoldi')}</span></div>
          {share !== null && <div className="pay-warn-bar" aria-hidden><span style={{ width: `${share * 100}%` }} /></div>}
        </>
      )}
      <div className="pay-warn-note">{t(over ? T('Pul o‘tkazib bo‘lgan bo‘lsangiz, restoranga murojaat qiling') : T('Boshqa summa yoki muddatdan keyin pul o‘tkazgan bo‘lsangiz, restoranga murojaat qiling'))}{phone ? <>: <a href={`tel:${phone}`} className="nowrap">{contactPhone}</a></> : '.'}</div>
    </div>
  );
}
