import { feeProgress, atBestPrice } from '../lib/fee';
import { som } from '../lib/format';
import type { PublicPricing } from '../lib/types';

/** The small bar above the cart button: how much more until the dishes get cheaper. No percentages, only so‘m. Renders nothing unless the fee model has stations. */
export function FeeProgress({ base, pricing }: { base: number; pricing: PublicPricing }) {
  const p = feeProgress(base, pricing);
  if (!p) {
    return atBestPrice(base, pricing) ? <div className="feebar done" role="status"><span>Eng qulay narxlar</span><div className="track"><i style={{ width: '100%' }} /></div></div> : null;
  }
  return (
    <div className="feebar" role="status">
      <span>Yana <b>{som(p.remainingSom)}</b> qo‘shing — taomlar {p.first ? 'arzonlasha boshlaydi' : 'yana arzonlashadi'}</span>
      <div className="track"><i style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
    </div>
  );
}

/** A dish price: the current one, and — once the basket made it cheaper — the earlier one crossed out with the difference. */
export function PriceTag({ unitSom, referenceSom }: { unitSom: number; referenceSom: number }) {
  const saved = referenceSom - unitSom;
  return (
    <span className="pricetag">
      <span className="price">{som(unitSom)}</span>
      {saved > 0 && <><s className="was">{som(referenceSom)}</s><b className="off">−{som(saved)}</b></>}
    </span>
  );
}
