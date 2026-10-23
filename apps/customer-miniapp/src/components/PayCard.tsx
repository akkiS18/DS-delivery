import { Button } from './ui';

/** "8600123456781234" -> "8600 1234 5678 1234" */
export const groupCard = (n: string): string => n.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();

/**
 * The card the customer pays to, drawn like a real bank card: the whole number on ONE line, the name of the owner underneath, so the
 * customer can see they are paying the right person. Tapping the number or the button below copies the digits.
 */
export function PayCard({ number, holder, onCopy }: { number: string; holder: string; onCopy: (digits: string) => void }) {
  const digits = number.replace(/\D/g, '');
  return (
    <div className="stack">
      <div className="paycard" role="group" aria-label="To‘lov kartasi">
        <div className="paycard-top" aria-hidden><span className="paycard-chip" /><span className="paycard-brand">KARTA</span></div>
        <button type="button" className="paycard-number" onClick={() => onCopy(digits)} aria-label="Karta raqamini nusxalash">{groupCard(digits)}</button>
        <div className="paycard-holder"><span className="paycard-cap">KARTA EGASI</span><span className="paycard-name">{holder}</span></div>
      </div>
      <Button variant="secondary" onClick={() => onCopy(digits)}>Karta raqamini nusxalash</Button>
    </div>
  );
}
