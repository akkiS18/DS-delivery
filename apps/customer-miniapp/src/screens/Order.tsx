import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons, Sheet } from '../components/ui';
import { PayCard } from '../components/PayCard';
import { PaidDialog } from '../components/PaidDialog';
import { PayWarning } from '../components/PayWarning';
import { StatusHero } from '../components/StatusHero';
import { api, ApiError } from '../lib/api';
import { describeCheckoutError } from '../lib/checkoutErrors';
import { clock, som } from '../lib/format';
import { anchorOf, isTerminal, paymentRemainingSeconds, pollIntervalMs, shouldAnnouncePaid, windowMinutes, type Anchor } from '../lib/order';
import { troubleHint } from '../lib/support';
import { confirmDialog, haptic } from '../lib/telegram';
import type { Route } from '../lib/router';
import type { CustomerStage, OrderView } from '../lib/types';
import { useApp, useNow } from '../state';

export function OrderScreen({ id, go }: { id: string; go: (r: Route) => void }) {
  const { config, toast } = useApp();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'pay' | 'cancel' | 'received' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receipt, setReceipt] = useState<{ mime: string; dataBase64: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const alive = useRef(true);
  const prevStage = useRef<CustomerStage | null>(null);
  const [paidNotice, setPaidNotice] = useState(false);

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

  // The moment payment turns into cooking, tell the customer in plain sight (once per order; remembered so a reload does not repeat it).
  useEffect(() => {
    if (!order) return;
    const key = `ds.paidSeen.${order.id}`;
    let seen = false;
    try { seen = localStorage.getItem(key) === '1'; } catch { /* storage may be unavailable */ }
    if (shouldAnnouncePaid(prevStage.current, order.stage, seen, order.paidAt, order.serverNow)) {
      try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
      setPaidNotice(true);
      haptic.success();
    }
    prevStage.current = order.stage;
  }, [order]);

  const payCounting = order?.stage === 'PAYMENT_PENDING' && Boolean(order.payment?.instructions?.expiresAt);
  const perfNow = useNow(1000, payCounting);

  if (!order && !error) return <div className="page"><Skeletons n={3} /></div>;
  if (!order) return <div className="page"><ErrorBox error={error} onRetry={() => void refresh()} /></div>;

  const o = order;
  const pay = o.payment;
  const ins = pay?.instructions ?? null;
  const cash = pay?.method === 'CASH';
  const awaiting = o.stage === 'PAYMENT_PENDING';
  const payLeft = awaiting && anchor ? paymentRemainingSeconds(ins?.expiresAt, anchor, perfNow) : null;
  const trouble = troubleHint(o, payLeft);
  const writeAbout = () => go({ name: 'supportNew', orderId: o.id });

  const mockPay = async () => {
    if (busy) return;
    setBusy('pay');
    try { adopt((await api.mockPay(o.id)).order); haptic.success(); }
    catch (e) { haptic.error(); toast(e instanceof ApiError && e.status === 429 ? 'Biroz kuting va qayta urinib ko‘ring' : 'To‘lovni qayd etib bo‘lmadi'); }
    finally { setBusy(null); }
  };
  const payCash = async () => {
    if (busy) return;
    setBusy('pay');
    try { adopt((await api.payCash(o.id)).order); haptic.success(); toast('Naqd to‘lov: restoran tasdiqlashini kuting'); }
    catch (e) { haptic.error(); toast(describeCheckoutError(e).message); void refresh(); }
    finally { setBusy(null); }
  };
  const received = async () => {
    if (busy) return;
    setBusy('received');
    try { adopt((await api.confirmReceived(o.id)).order); haptic.success(); }
    catch { haptic.error(); toast('Saqlab bo‘lmadi. Qayta urinib ko‘ring'); }
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
      {paidNotice && <PaidDialog cash={cash} onClose={() => setPaidNotice(false)} />}
      <div className="row between">
        <div>
          <h1 className="page-title">Buyurtma #{o.code}</h1>
          <p className="sub">{o.restaurantName} • {clock(o.createdAt)}</p>
        </div>
        {o.isTest && <span className="badge test">TEST</span>}
      </div>

      <div className="card stack">
        <StatusHero stage={o.stage} cash={cash} />
        {o.stage === 'DELIVERED' && <p className="sub center">{o.deliveredAt ? `${clock(o.deliveredAt)} • ` : ''}Yoqimli ishtaha!</p>}
        {o.canConfirmReceived && !o.receivedAt && (
          <div className="stack">
            <div className="bold center">Buyurtmani oldingizmi?</div>
            <Button loading={busy === 'received'} onClick={() => void received()}>Ha, oldim</Button>
          </div>
        )}
        {o.receivedAt && <p className="sub center">Qabul qilganingiz uchun rahmat!</p>}
        {o.stage === 'SELF_DELIVERY' && <div className="banner notice">Restoran buyurtmani o‘zi olib boradi. Taksi chaqirilmaydi, yetkazish uchun alohida haq to‘lamaysiz.</div>}
        {o.deliveryPreference === 'WALK_OK' && ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING'].includes(o.stage) && (
          <div className="banner notice">Siz “uyim yaqin, piyoda olib borsa bo‘ladi” deb belgilagansiz. Yakuniy qarorni restoran qiladi: rozi bo‘lmasa, taksi chaqiriladi.</div>
        )}
        {o.stage === 'NEEDS_HELP' && <div className="banner warn">Yetkazishni tashkil qilishda yordam kerak. Jamoamiz hal qilmoqda — buyurtmangiz bekor bo‘lmaydi.</div>}
        {o.stage === 'EXPIRED' && <div className="banner bad">{cash ? 'Restoran buyurtmani vaqtida tasdiqlamadi.' : 'To‘lov muddati tugadi.'} Yangi buyurtma bering.</div>}
        {trouble && (
          <div className="banner warn stack" role="alert">
            <div>{trouble}</div>
            <Button onClick={writeAbout}>Muammo haqida yozish</Button>
          </div>
        )}
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

      {awaiting && pay && cash && (
        <div className="card stack" aria-label="Naqd to‘lov">
          <h2 style={{ fontSize: 17 }}>Naqd to‘lov</h2>
          <div className="row between"><span>Haydovchiga beriladigan summa</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.cash?.dueSom ?? pay.amountSom)}</span></div>
          <div className="banner" role="status"><strong>Restoran buyurtmani tasdiqlashini kutyapmiz.</strong><br />Tasdiqlangach taom tayyorlanadi{pay.cash?.acceptBy ? `. Javob muddati: ${clock(pay.cash.acceptBy)} gacha` : ''}. Karta yoki o‘tkazma kerak emas.</div>
        </div>
      )}
      {!awaiting && cash && pay?.cash && !isTerminal(o.stage) && (
        <div className="card stack" aria-label="Naqd to‘lov">
          <div className="row between"><span className="bold">Naqd to‘lov</span><span className="bold mono">{som(pay.cash.dueSom)}</span></div>
          <p className="sub small">Taom narxini yetkazib berilganda haydovchiga bering. Yetkazish haqi taksi tarifi bo‘yicha alohida.</p>
        </div>
      )}

      {awaiting && pay && !cash && (
        <div className="card stack" aria-label="To‘lov">
          <h2 style={{ fontSize: 17 }}>To‘lov</h2>
          <div className="row between"><span>To‘lov summasi</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.amountSom)}</span></div>
          {pay.queued && (
            <div className="banner warn">To‘lov rekvizitlari hozir band. Birozdan keyin avtomatik ko‘rinadi.
              <div style={{ marginTop: 8 }}><Button small variant="secondary" loading={busy === 'pay'} onClick={() => void payCash()}>Naqd to‘lash</Button></div>
            </div>
          )}
          {ins && pay.mode === 'REAL' && (
            ins.recipientUnavailable || !ins.cardNumber
              ? <div className="banner bad" role="alert"><strong>To‘lov qabul qiluvchi hozircha sozlanmagan.</strong><br />Hozir pul o‘tkazmang. Restoran bilan bog‘laning yoki keyinroq qaytib keling.</div>
              : (
                <div className="stack">
                  <PayWarning amountSom={pay.amountSom} windowMinutes={windowMinutes(ins.windowSeconds)} remaining={payLeft} total={ins.windowSeconds ?? null} contactPhone={o.restaurantPhone} />
                  <PayCard number={ins.cardNumber} holder={ins.cardHolder ?? o.restaurantName} onCopy={d => void copy(d)} />
                </div>
              )
          )}
          {ins && ins.expiresAt && payLeft === null && <p className="sub small">To‘lov muddati: {clock(ins.expiresAt)} gacha.</p>}
          {pay.mode === 'MOCK' && config?.mockPaymentAvailable && (
            <>
              <div className="banner">Sinov rejimi: haqiqiy pul olinmaydi.</div>
              <Button loading={busy === 'pay'} onClick={() => void mockPay()}>Sinov to‘lovini bajarish</Button>
            </>
          )}
          {o.stage === 'PAYMENT_PENDING' && pay.mode === 'REAL' && <p className="sub small">O‘tkazgandan so‘ng bu sahifada qoling — holat o‘zi yangilanadi.</p>}
        </div>
      )}

      <div className="card stack">
        <h2 style={{ fontSize: 17 }}>Buyurtma tarkibi</h2>
        {o.items.map((it, i) => <div key={i} className="row between small"><span className="grow">{it.quantity} × {it.name}</span><span className="mono">{som(it.subtotalSom)}</span></div>)}
        <div className="divider" />
        <div className="row between"><span className="bold">Taomlar jami</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>
        {o.deliveryMode === 'SELF'
          ? <div className="row between sub small"><span>Yetkazish</span><span>restoran o‘zi, haqsiz</span></div>
          : <div className="row between sub small"><span>Yetkazish{o.taxiCompanyName ? ` (${o.taxiCompanyName})` : ''}</span><span>{o.deliveryPreference === 'WALK_OK' && ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING'].includes(o.stage) ? 'restoran piyoda yoki taksi (alohida)' : 'taksi tarifi bo‘yicha, alohida'}</span></div>}
        <div className="sub small row" style={{ alignItems: 'flex-start' }}><Icon as={MapPin} size={16} className="shrink" /><span className="grow">{o.address}</span></div>
      </div>

      {o.cancel.allowed && !isTerminal(o.stage) && (
        <Button variant="danger" loading={busy === 'cancel'} onClick={() => setConfirmCancel(true)}>
          {o.cancel.kind === 'UNPAID' ? 'Buyurtmani bekor qilish' : 'Bekor qilish so‘rovi'}
        </Button>
      )}
      {!trouble && <Button variant="ghost" onClick={writeAbout}>Muammo bormi? Yozing</Button>}
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
