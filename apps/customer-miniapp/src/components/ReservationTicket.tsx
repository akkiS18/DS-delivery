import { Check, Phone } from 'lucide-react';
import { CottonPattern } from './CottonPattern';
import { Icon } from './ui';
import { som } from '../lib/format';
import { STATUS_LABEL, ticketWhen } from '../lib/reservation';
import type { ReservationView } from '../lib/types';
import { t } from '../i18n';

/** A paid reservation as a ticket: green top with the confirmation, date / time / guests, a perforation, the deposit and a call button. */
export function ReservationTicket({ r, id, onOpen }: { r: ReservationView; id: string; onOpen?: () => void }) {
  const when = ticketWhen(r.startsAt);
  const phone = r.restaurantPhone ? r.restaurantPhone.replace(/[^\d+]/g, '') : '';
  const body = (
    <>
      <div className="tkt-top">
        <CottonPattern id={id} />
        <span className="tkt-check" aria-hidden><Icon as={Check} size={28} /></span>
        <div className="tkt-title"><h3>{t(STATUS_LABEL[r.status])}</h3><span>{r.restaurantName} • {t('Bron #{code}', { code: r.code })}</span></div>
      </div>
      <div className="tkt-grid">
        <div><span>{t('Sana')}</span><b>{when.day}</b><span>{when.weekday}</span></div>
        <div><span>{t('Vaqt')}</span><b>{when.time}</b></div>
        <div><span>{t('Mehmonlar')}</span><b>{t('{n} kishi', { n: r.partySize })}</b></div>
      </div>
      <div className="receipt-notch" aria-hidden><i /></div>
      <div className="tkt-foot">
        <div className="tkt-dep"><span>{t('Oldindan to‘lov')}</span><b>{som(r.depositSom)} • {t('to‘landi')}</b></div>
        {r.note && <p className="sub small">{t('Izoh')}: {r.note}</p>}
      </div>
    </>
  );
  return (
    <article className="ticket">
      {onOpen
        ? <div className="tkt-tap" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>{body}</div>
        : body}
      {phone && <a className="tkt-call" href={`tel:${phone}`}><Icon as={Phone} size={20} />{t('Restoranga qo‘ng‘iroq: {phone}', { phone: r.restaurantPhone ?? '' })}</a>}
    </article>
  );
}
