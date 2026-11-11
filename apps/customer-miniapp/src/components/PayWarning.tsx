import { TriangleAlert } from 'lucide-react';
import { mmss, som } from '../lib/format';
import { Icon } from './ui';
import { t, T } from '../i18n';
import { rich } from '../i18n/rich';

/** "Shirin" mode (the restaurant checks its own bank): the same yellow notice, with the exact amount but no payment window and no countdown. */
export function ManualPayNote({ amountSom, contactPhone }: { amountSom: number; contactPhone?: string | null }) {
  const phone = contactPhone ? contactPhone.replace(/[^\d+]/g, '') : '';
  return (
    <div className="pay-warn" role="alert">
      <div className="pay-warn-head">
        <Icon as={TriangleAlert} size={22} className="shrink" />
        <strong>{rich('Mana shu kartaga aynan {sum} o‘tkazing.', { sum: <span className="nowrap">{som(amountSom)}</span> })}</strong>
      </div>
      <div className="pay-warn-note">{t('Restoran pulni ko‘rgach buyurtmani o‘zi tasdiqlaydi. Shu sahifada qoling — holat o‘zi yangilanadi.')}</div>
      <div className="pay-warn-note">{t('Boshqa summa o‘tkazgan bo‘lsangiz, restoranga murojaat qiling')}{phone ? <>: <a href={`tel:${phone}`} className="nowrap">{contactPhone}</a></> : '.'}</div>
    </div>
  );
}

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
        <div className="pay-ring" role="timer" aria-live="off" aria-label={`${mmss(remaining)} ${t('qoldi')}`}>
          <svg aria-hidden width="96" height="96" viewBox="0 0 124 124">
            <circle cx="62" cy="62" r="54" className="pay-ring-bg" />
            <circle cx="62" cy="62" r="54" className="pay-ring-fg" strokeDasharray="339.3" strokeDashoffset={339.3 * (1 - (share ?? 1))} />
          </svg>
          <span className="pay-ring-time"><span className="mono">{mmss(remaining)}</span><span className="pay-ring-left">{t('qoldi')}</span></span>
        </div>
      )}
      <div className="pay-warn-note">{t(over ? T('Pul o‘tkazib bo‘lgan bo‘lsangiz, restoranga murojaat qiling') : T('Boshqa summa yoki muddatdan keyin pul o‘tkazgan bo‘lsangiz, restoranga murojaat qiling'))}{phone ? <>: <a href={`tel:${phone}`} className="nowrap">{contactPhone}</a></> : '.'}</div>
    </div>
  );
}
