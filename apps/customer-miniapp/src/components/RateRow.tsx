import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { Button, Icon, Sheet } from './ui';
import { api, ApiError } from '../lib/api';
import { NOTE_MAX, RATING_REASONS, needsReasons, type ReasonCode } from '../lib/rating';
import { haptic } from '../lib/telegram';
import { useApp } from '../state';

const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

function Stars({ value, onPick, label }: { value: number; onPick?: (n: number) => void; label: string }) {
  return (
    <div className="stars" role={onPick ? 'group' : 'img'} aria-label={onPick ? label : `${label}: ${value} yulduz`}>
      {[1, 2, 3, 4, 5].map(n => {
        const glyph = <Icon as={Star} size={onPick ? 30 : 18} className={n <= value ? 'star on' : 'star'} />;
        return onPick
          ? <button key={n} type="button" className="star-btn" aria-label={`${n} yulduz`} aria-pressed={n === value} onClick={e => { stop(e); haptic.tap(); onPick(n); }}>{glyph}</button>
          : <span key={n}>{glyph}</span>;
      })}
    </div>
  );
}

/**
 * The rating line on a delivered order's card: "Restoran taomini baholang" with five tappable stars. 4-5 stars are saved with one tap; 1-3 open a
 * short sheet with quick reasons. After the 24 h window the given rating is shown but cannot be changed. Nothing here ever pops up on its own.
 */
export function RateRow({ orderId, rating, canRate, onSaved }: { orderId: string; rating: number | null; canRate: boolean; onSaved: () => void }) {
  const { toast } = useApp();
  const [pending, setPending] = useState<number | null>(null);
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!canRate && rating === null) return null;

  const save = async (stars: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.rateOrder(orderId, { stars, ...(needsReasons(stars) ? { reasons, ...(note.trim() ? { note: note.trim() } : {}) } : {}) });
      haptic.success();
      toast('Bahoyingiz uchun rahmat');
      setPending(null); setReasons([]); setNote('');
      onSaved();
    } catch (e) {
      haptic.error();
      toast(e instanceof ApiError && e.code === 'BAHOLASH_MUDDATI_TUGADI' ? 'Baholash muddati tugagan' : 'Saqlab bo‘lmadi. Qayta urinib ko‘ring');
      if (e instanceof ApiError && e.status === 409) { setPending(null); onSaved(); }
    } finally { setBusy(false); }
  };
  const pick = (n: number) => { if (needsReasons(n)) setPending(n); else void save(n); };

  return (
    <div className="raterow" onClick={stop} onKeyDown={stop} role="group" aria-label="Taomni baholash">
      {rating === null
        ? <><div className="rate-title">Restoran taomini baholang</div><Stars value={0} onPick={pick} label="Taomni baholang" /></>
        : (
          <div className="row between">
            <span className="rate-title">Bahongiz</span>
            {canRate ? <Stars value={rating} onPick={pick} label="Bahoni o‘zgartirish" /> : <Stars value={rating} label="Bahongiz" />}
          </div>
        )}
      {pending !== null && (
        <Sheet title="Nima yoqmadi?" onClose={() => setPending(null)}>
          <div className="stack">
            <Stars value={pending} label="Baho" />
            <div className="chips wrap" role="group" aria-label="Sabablar">
              {RATING_REASONS.map(r => (
                <button key={r.code} type="button" className={`chip ${reasons.includes(r.code) ? 'on' : ''}`} aria-pressed={reasons.includes(r.code)}
                  onClick={() => setReasons(reasons.includes(r.code) ? reasons.filter(x => x !== r.code) : [...reasons, r.code])}>{r.label}</button>
              ))}
            </div>
            <textarea className="input" rows={3} maxLength={NOTE_MAX} value={note} placeholder="Izoh (ixtiyoriy). Faqat restoran va administrator ko‘radi." aria-label="Izoh" onChange={e => setNote(e.target.value)} />
            <Button loading={busy} onClick={() => void save(pending)}>Yuborish</Button>
            <Button variant="secondary" onClick={() => setPending(null)}>Bekor qilish</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
