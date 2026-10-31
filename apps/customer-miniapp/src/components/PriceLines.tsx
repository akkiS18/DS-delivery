import { Truck } from 'lucide-react';
import { lineShown } from '../lib/fee';
import { som } from '../lib/format';
import type { PublicPricing } from '../lib/types';
import { Icon } from './ui';

const strike = { textDecoration: 'line-through' } as const;

/**
 * The separate "Platforma xizmati" line (owner decision 2026-10-31). Charged: "5 000 so‘m". Waived by the administrator: the 5 000 is crossed out and
 * marked as a discount, so the customer sees what they are being spared. Nothing for any other fee mode.
 */
export function PlatformLine({ pricing }: { pricing: PublicPricing }) {
  const l = lineShown(pricing);
  if (!l) return null;
  return <PlatformLineRow chargedSom={l.waived ? 0 : l.somShown} waivedSom={l.waived ? l.somShown : 0} />;
}

/** The same row for a placed order (amounts come from the server's frozen order). */
export function PlatformLineRow({ chargedSom, waivedSom }: { chargedSom: number; waivedSom: number }) {
  if (chargedSom <= 0 && waivedSom <= 0) return null;
  return (
    <div className="row between">
      <span>Platforma xizmati</span>
      {waivedSom > 0
        ? <span><span className="mono sub" style={strike}>{som(waivedSom)}</span> <span className="saved">Chegirma</span></span>
        : <span className="bold mono">{som(chargedSom)}</span>}
    </div>
  );
}

/**
 * The taxi fare is NOT part of the food total and is not known to the platform: the taxi service names it and the customer pays the driver.
 * Shown as its own highlighted box (owner 2026-10-31: "nobody reads" the small grey line), in the cart, at checkout and on the order.
 */
export function TaxiFareBox({ walk = false, taxiName, selfDelivered = false }: { walk?: boolean; taxiName?: string | null; selfDelivered?: boolean }) {
  if (selfDelivered) {
    return (
      <div className="banner notice" role="note">
        <Icon as={Truck} size={22} />
        <div><strong>Yetkazish: restoran o‘zi olib boradi — haq yo‘q.</strong></div>
      </div>
    );
  }
  return (
    <div className="banner warn notice" role="note">
      <Icon as={Truck} size={22} />
      <div>
        <strong>Taksi haqi alohida — taom narxiga kirmaydi.</strong>
        <div>
          {walk ? 'Restoran piyoda olib borishga rozi bo‘lsa, taksi haqi to‘lanmaydi. Rozi bo‘lmasa, ' : ''}
          Yetkazish narxini {taxiName ? `«${taxiName}»` : 'taksi xizmati'} belgilaydi va u alohida to‘lanadi — platforma bu summani oldindan hisoblamaydi.
        </div>
      </div>
    </div>
  );
}
