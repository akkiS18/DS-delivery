import { feeProgress, atBestPrice } from '../lib/fee';
import { som } from '../lib/format';
import type { PublicPricing } from '../lib/types';
import { t, T } from '../i18n';
import { rich } from '../i18n/rich';

/** The small bar above the cart button: how much more until the dishes get cheaper. No percentages, only so‘m. Renders nothing unless the fee model has stations. */
export function FeeProgress({ base, pricing }: { base: number; pricing: PublicPricing }) {
  const p = feeProgress(base, pricing);
  if (!p) {
    return atBestPrice(base, pricing) ? <div className="feebar done" role="status"><span>{t('Eng qulay narxlar')}</span><div className="track"><i style={{ width: '100%' }} /></div></div> : null;
  }
  return (
    <div className="feebar" role="status">
      <span>{rich(p.first ? T('Yana <b>{sum}</b> qo‘shing — taomlar arzonlasha boshlaydi') : T('Yana <b>{sum}</b> qo‘shing — taomlar yana arzonlashadi'), { sum: som(p.remainingSom) })}</span>
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
