import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, MapPin } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons, Sheet } from '../components/ui';
import { PayCard } from '../components/PayCard';
import { api, ApiError } from '../lib/api';
import { clock, mmss, som } from '../lib/format';
import { anchorOf, isTerminal, overdueMinutes, pollIntervalMs, remainingSeconds, STAGE_LABEL, timeline, type Anchor } from '../lib/order';
import { confirmDialog, haptic } from '../lib/telegram';
import type { OrderView } from '../lib/types';
import { useApp, useNow } from '../state';

export function OrderScreen({ id }: { id: string }) {
  const { config, toast } = useApp();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receipt, setReceipt] = useState<{ mime: string; dataBase64: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const alive = useRef(true);

  const adopt = useCallback((o: OrderView) => { setOrder(o); setAnchor(anchorOf(o.serverNow, performance.now())); setError(null); }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { adopt((await api.order(id, signal)).order); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
  }, [id, adopt]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const ac = new AbortController(); void refresh(ac.signal); return () => ac.abort(); }, [refresh]);

  // Polling (not push): cadence depends on the stage, stops when terminal, pauses while the page is hidden.
  const stage = order?.stage;
  useEffect(() => {
    if (!stage) return;
    const every = pollIntervalMs(stage);
    if (every === null) return;
    let t: number | undefined;
    const start = () => { stop(); t = window.setInterval(() => void refresh(), every); };
    const stop = () => { if (t !== undefined) window.clearInterval(t); t = undefined; };
    const vis = () => { if (document.hidden) stop(); else { void refresh(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [stage, refresh]);

  const counting = order?.stage === 'PREPARING' && Boolean(order.prep.estimatedReadyAt);
  const perfNow = useNow(1000, counting);

  if (!order && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!order) return <div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div>;

  const o = order;
  const rem = counting && anchor ? remainingSeconds(o.prep, anchor, perfNow) : null;
  const steps = timeline(o);
  const pay = o.payment;
  const ins = pay?.instructions ?? null;
  const awaiting = o.stage === 'PAYMENT_PENDING';

  const mockPay = async () => {
    if (busy) return;
    setBusy('pay');
    try { adopt((await api.mockPay(o.id)).order); haptic.success(); }
    catch (e) { haptic.error(); toast(e instanceof ApiError && e.status === 429 ? 'Biroz kuting va qayta urinib ko‘ring' : 'To‘lovni qayd etib bo‘lmadi'); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    setConfirmCancel(false);
    if (busy) return;
    setBusy('cancel');
    try { adopt((await api.cancelOrder(o.id, 'CHANGED_MIND')).order); toast(o.cancel.kind === 'UNPAID' ? 'Buyurtma bekor qilindi' : 'So‘rov yuborildi'); }
    catch { haptic.error(); toast('Bekor qilib bo‘lmadi'); }
    finally { setBusy(null); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text.replace(/\D/g, '')); toast('Nusxalandi'); } catch { toast('Nusxalab bo‘lmadi'); }
  };

  return (
    <div className="page">
      <div className="row between">
        <div>
          <h1 className="page-title">Buyurtma #{o.number}</h1>
          <p className="sub">{o.restaurantName} • {clock(o.createdAt)}</p>
        </div>
        {o.isTest && <span className="badge test">TEST</span>}
      </div>

      <div className="card stack" aria-live="polite">
        <div className="bold" style={{ fontSize: 20 }}>{STAGE_LABEL[o.stage]}</div>
        {rem !== null && (
          rem > 0
            ? <div><span className="mono bold" style={{ fontSize: 34 }}>{mmss(rem)}</span><span className="sub"> • tayyor bo‘lish taxminan {clock(o.prep.estimatedReadyAt)}</span></div>
            : <div className="banner warn" role="status"><strong>Kechikish: {overdueMinutes(rem)} daqiqa</strong><br />Restoran buyurtmani hali tayyorlayapti. Kechikkanimiz uchun uzr.</div>
        )}
        {o.stage === 'READY' && <p className="sub">Taom tayyor — taksi operatoriga uzatilmoqda.</p>}
        {o.stage === 'TAXI_REQUESTED' && <p className="sub">Taksi xizmatiga so‘rov yuborildi. Hali qabul qilinmagan bo‘lishi mumkin.</p>}
        {o.stage === 'TAXI_ACCEPTED' && <p className="sub">Operator buyurtmani qabul qildi. Haydovchi hali yo‘lga chiqmagan bo‘lishi mumkin.</p>}
        {o.stage === 'TAXI_SENT' && <p className="sub">{o.taxi?.companyName ? `${o.taxi.companyName} haydovchi yubordi.` : 'Haydovchi yo‘lga chiqdi.'}</p>}
        {o.stage === 'DELIVERED' && <p className="sub">Yetkazildi{o.deliveredAt ? ` • ${clock(o.deliveredAt)}` : ''}. Yoqimli ishtaha!</p>}
        {o.stage === 'NEEDS_HELP' && <div className="banner warn">Yetkazishni tashkil qilishda yordam kerak. Jamoamiz hal qilmoqda — buyurtmangiz bekor bo‘lmaydi.</div>}
        {o.stage === 'EXPIRED' && <div className="banner bad">To‘lov muddati tugadi. Yangi buyurtma bering.</div>}
        {o.refund && <div className="banner">Pulni qaytarish holati: <strong>{o.refund.status}</strong></div>}
        {o.refund?.hasReceipt && (
          <div className="stack">
            {receipt
              ? (
                <>
                  <img alt="Restoran yuborgan bank cheki" src={`data:${receipt.mime};base64,${receipt.dataBase64}`} style={{ maxWidth: '100%', borderRadius: 12 }} />
                  <Button small variant="secondary" onClick={() => setReceipt(null)}>Chekni yopish</Button>
                </>
              )
              : (
                <Button small variant="secondary" loading={receiptBusy} onClick={() => {
                  setReceiptBusy(true);
                  api.refundReceipt(id).then(r => setReceipt(r), () => toast('Chek rasmini yuklab bo‘lmadi. Keyinroq urinib ko‘ring.')).finally(() => { if (alive.current) setReceiptBusy(false); });
                }}>Qaytarish chekini ko‘rish</Button>
              )}
          </div>
        )}
      </div>

      {awaiting && pay && (
        <div className="card stack" aria-label="To‘lov">
          <h2 style={{ fontSize: 17 }}>To‘lov</h2>
          <div className="row between"><span>To‘lov summasi</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.amountSom)}</span></div>
          {pay.queued && <div className="banner warn">To‘lov rekvizitlari hozir band. Birozdan keyin avtomatik ko‘rinadi.</div>}
          {ins && pay.mode === 'REAL' && (
            ins.recipientUnavailable || !ins.cardNumber
              ? <div className="banner bad" role="alert"><strong>To‘lov qabul qiluvchi hozircha sozlanmagan.</strong><br />Hozir pul o‘tkazmang. Restoran bilan bog‘laning yoki keyinroq qaytib keling.</div>
              : (
                <div className="stack">
                  <div className="sub small">Quyidagi kartaga aynan shu summani o‘tkazing:</div>
                  <PayCard number={ins.cardNumber} holder={ins.cardHolder ?? o.restaurantName} onCopy={d => void copy(d)} />
                </div>
              )
          )}
          {ins && ins.expiresAt && <p className="sub small">To‘lov muddati: {clock(ins.expiresAt)} gacha.</p>}
          {pay.mode === 'MOCK' && config?.mockPaymentAvailable && (
            <>
              <div className="banner">Sinov rejimi: haqiqiy pul olinmaydi.</div>
              <Button loading={busy === 'pay'} onClick={() => void mockPay()}>Sinov to‘lovini bajarish</Button>
            </>
          )}
          {o.stage === 'PAYMENT_PENDING' && pay.mode === 'REAL' && <p className="sub small">O‘tkazgandan so‘ng bu sahifada qoling — holat o‘zi yangilanadi.</p>}
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 17, marginBottom: 6 }}>Holat</h2>
        <ol className="timeline" style={{ listStyle: 'none', padding: 0 }}>
          {steps.map(s => (
            <li key={s.key} className={`step ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="mark" aria-hidden>{s.state === 'done' ? <Icon as={Check} size={14} /> : s.state === 'bad' ? <Icon as={AlertTriangle} size={14} /> : null}</span>
              <div><div>{s.label}</div>{s.note && <div className="sub small">{s.note}</div>}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: 17 }}>Buyurtma tarkibi</h2>
        {o.items.map((it, i) => <div key={i} className="row between small"><span className="grow">{it.quantity} × {it.name}</span><span className="mono">{som(it.subtotalSom)}</span></div>)}
        <div className="divider" />
        <div className="row between"><span className="bold">Taomlar jami</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>
        <div className="row between sub small"><span>Yetkazish</span><span>taksi tarifi bo‘yicha, alohida</span></div>
        <div className="sub small row" style={{ alignItems: 'flex-start' }}><Icon as={MapPin} size={16} className="shrink" /><span className="grow">{o.address}</span></div>
      </div>

      {o.cancel.allowed && !isTerminal(o.stage) && (
        <Button variant="danger" loading={busy === 'cancel'} onClick={() => setConfirmCancel(true)}>
          {o.cancel.kind === 'UNPAID' ? 'Buyurtmani bekor qilish' : 'Bekor qilish so‘rovi'}
        </Button>
      )}
      {error && <div className="banner warn">Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.</div>}

      {confirmCancel && (
        <Sheet title="Bekor qilishni tasdiqlang" onClose={() => setConfirmCancel(false)}>
          <p className="sub" style={{ marginBottom: 12 }}>{o.cancel.kind === 'REFUND_REQUEST'
            ? 'To‘lov qilingan. Bekor qilish so‘rovi restoranga yuboriladi; pul qaytarilishi restoran qaroriga bog‘liq.'
            : 'Buyurtma bekor qilinadi. Pul o‘tkazgan bo‘lsangiz, bekor qilmang.'}</p>
          <div className="stack">
            <Button variant="danger" onClick={() => void cancel()}>Ha, bekor qilish</Button>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Yo‘q</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export { confirmDialog };
