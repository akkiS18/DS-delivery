import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button, ErrorBox, Icon, Skeletons, Sheet } from '../components/ui';
import { PayCard } from '../components/PayCard';
import { PaidDialog } from '../components/PaidDialog';
import { ManualPayNote, PayWarning } from '../components/PayWarning';
import { PlatformLineRow, TaxiFareBox } from '../components/PriceLines';
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
import { t } from '../i18n';
import { rich } from '../i18n/rich';

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
    let timer: number | undefined;
    const start = () => { stop(); timer = window.setInterval(() => void refresh(), every); };
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
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
    catch (e) { haptic.error(); toast(e instanceof ApiError && e.status === 429 ? t('Biroz kuting va qayta urinib ko‘ring') : t('To‘lovni qayd etib bo‘lmadi')); }
    finally { setBusy(null); }
  };
  const payCash = async () => {
    if (busy) return;
    setBusy('pay');
    try { adopt((await api.payCash(o.id)).order); haptic.success(); toast(t('Naqd to‘lov: restoran tasdiqlashini kuting')); }
    catch (e) { haptic.error(); toast(describeCheckoutError(e).message); void refresh(); }
    finally { setBusy(null); }
  };
  const received = async () => {
    if (busy) return;
    setBusy('received');
    try { adopt((await api.confirmReceived(o.id)).order); haptic.success(); }
    catch { haptic.error(); toast(t('Saqlab bo‘lmadi. Qayta urinib ko‘ring')); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    setConfirmCancel(false);
    if (busy) return;
    setBusy('cancel');
    try { adopt((await api.cancelOrder(o.id, 'CHANGED_MIND')).order); toast(o.cancel.kind === 'UNPAID' ? t('Buyurtma bekor qilindi') : t('So‘rov yuborildi')); }
    catch { haptic.error(); toast(t('Bekor qilib bo‘lmadi')); }
    finally { setBusy(null); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text.replace(/\D/g, '')); toast(t('Nusxalandi')); } catch { toast(t('Nusxalab bo‘lmadi')); }
  };

  return (
    <div className="page">
      {paidNotice && <PaidDialog cash={cash} onClose={() => setPaidNotice(false)} />}
      <div className="row between">
        <div>
          <h1 className="page-title">{t('Buyurtma #{code}', { code: o.code })}</h1>
          <p className="sub">{o.restaurantName} • {clock(o.createdAt)}</p>
        </div>
        {o.isTest && <span className="badge test">TEST</span>}
      </div>

      <div className="card stack">
        <StatusHero stage={o.stage} cash={cash} />
        {o.stage === 'DELIVERED' && <p className="sub center">{o.deliveredAt ? `${clock(o.deliveredAt)} • ` : ''}{t('Yoqimli ishtaha!')}</p>}
        {o.canConfirmReceived && !o.receivedAt && (
          <div className="stack">
            <div className="bold center">{t('Buyurtmani oldingizmi?')}</div>
            <Button loading={busy === 'received'} onClick={() => void received()}>{t('Ha, oldim')}</Button>
          </div>
        )}
        {o.receivedAt && <p className="sub center">{t('Qabul qilganingiz uchun rahmat!')}</p>}
        {o.awaitingRestaurant && o.cancel.allowed && <div className="banner notice" role="status">{t('To‘lov qabul qilindi. Restoran buyurtmani qabul qilishini kutyapmiz. Qabul qilgunicha buyurtmani bekor qilishingiz mumkin.')}</div>}
        {o.restaurantAccepted && !o.cancel.allowed && !isTerminal(o.stage) && o.stage !== 'PAYMENT_PENDING' && (
          <div className="banner notice" role="note">{rich('Restoran buyurtmani qabul qildi — endi uni ilovadan bekor qilib bo‘lmaydi. Jiddiy sabab bo‘lsa, restoranga qo‘ng‘iroq qiling{phone}.', { phone: o.restaurantPhone ? <>: <a href={`tel:${o.restaurantPhone}`}>{o.restaurantPhone}</a></> : '' })}</div>
        )}
        {o.stage === 'SELF_DELIVERY' && <div className="banner notice">{t('Restoran buyurtmani o‘zi olib boradi. Taksi chaqirilmaydi, yetkazish uchun alohida haq to‘lamaysiz.')}</div>}
        {o.deliveryPreference === 'WALK_OK' && ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING'].includes(o.stage) && (
          <div className="banner notice">{t('Siz “uyim yaqin, piyoda olib borsa bo‘ladi” deb belgilagansiz. Yakuniy qarorni restoran qiladi: rozi bo‘lmasa, taksi chaqiriladi.')}</div>
        )}
        {o.stage === 'NEEDS_HELP' && <div className="banner warn">{t('Yetkazishni tashkil qilishda yordam kerak. Jamoamiz hal qilmoqda — buyurtmangiz bekor bo‘lmaydi.')}</div>}
        {o.stage === 'EXPIRED' && <div className="banner bad">{cash ? t('Restoran buyurtmani vaqtida tasdiqlamadi.') : t('To‘lov muddati tugadi.')} {t('Yangi buyurtma bering.')}</div>}
        {trouble && (
          <div className="banner warn stack" role="alert">
            <div>{trouble}</div>
            <Button onClick={writeAbout}>{t('Muammo haqida yozish')}</Button>
          </div>
        )}
        {o.refund && <div className="banner">{rich('Pulni qaytarish holati: {status}', { status: <strong>{o.refund.status}</strong> })}</div>}
        {o.refund?.hasReceipt && (
          <div className="stack">
            {receipt
              ? (
                <>
                  <img alt={t('Restoran yuborgan bank cheki')} src={`data:${receipt.mime};base64,${receipt.dataBase64}`} style={{ maxWidth: '100%', borderRadius: 12 }} />
                  <Button small variant="secondary" onClick={() => setReceipt(null)}>{t('Chekni yopish')}</Button>
                </>
              )
              : (
                <Button small variant="secondary" loading={receiptBusy} onClick={() => {
                  setReceiptBusy(true);
                  api.refundReceipt(id).then(r => setReceipt(r), () => toast(t('Chek rasmini yuklab bo‘lmadi. Keyinroq urinib ko‘ring.'))).finally(() => { if (alive.current) setReceiptBusy(false); });
                }}>{t('Qaytarish chekini ko‘rish')}</Button>
              )}
          </div>
        )}
      </div>

      {awaiting && pay && cash && (
        <div className="card stack" aria-label={t('Naqd to‘lov')}>
          <h2 style={{ fontSize: 17 }}>{t('Naqd to‘lov')}</h2>
          <div className="row between"><span>{t('Haydovchiga beriladigan summa')}</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.cash?.dueSom ?? pay.amountSom)}</span></div>
          <div className="banner" role="status"><strong>{t('Restoran buyurtmani tasdiqlashini kutyapmiz.')}</strong><br />{pay.cash?.acceptBy ? t('Tasdiqlangach taom tayyorlanadi. Javob muddati: {time} gacha. Karta yoki o‘tkazma kerak emas.', { time: clock(pay.cash.acceptBy) }) : t('Tasdiqlangach taom tayyorlanadi. Karta yoki o‘tkazma kerak emas.')}</div>
        </div>
      )}
      {!awaiting && cash && pay?.cash && !isTerminal(o.stage) && (
        <div className="card stack" aria-label={t('Naqd to‘lov')}>
          <div className="row between"><span className="bold">{t('Naqd to‘lov')}</span><span className="bold mono">{som(pay.cash.dueSom)}</span></div>
          <p className="sub small">{t('Taom narxini yetkazib berilganda haydovchiga bering. Yetkazish haqi taksi tarifi bo‘yicha alohida.')}</p>
        </div>
      )}

      {awaiting && pay && !cash && (
        <div className="card stack" aria-label={t('To‘lov')}>
          <h2 style={{ fontSize: 17 }}>{t('To‘lov')}</h2>
          <div className="row between"><span>{t('To‘lov summasi')}</span><span className="bold mono" style={{ fontSize: 20 }}>{som(pay.amountSom)}</span></div>
          {pay.queued && (
            <div className="banner warn">{t('To‘lov rekvizitlari hozir band. Birozdan keyin avtomatik ko‘rinadi.')}
              <div style={{ marginTop: 8 }}><Button small variant="secondary" loading={busy === 'pay'} onClick={() => void payCash()}>{t('Naqd to‘lash')}</Button></div>
            </div>
          )}
          {ins && pay.mode === 'REAL' && (
            ins.recipientUnavailable || !ins.cardNumber
              ? <div className="banner bad" role="alert"><strong>{t('To‘lov qabul qiluvchi hozircha sozlanmagan.')}</strong><br />{t('Hozir pul o‘tkazmang. Restoran bilan bog‘laning yoki keyinroq qaytib keling.')}</div>
              : (
                <div className="stack">
                  {ins.manualCheck
                    ? <ManualPayNote amountSom={pay.amountSom} contactPhone={o.restaurantPhone} />
                    : <PayWarning amountSom={pay.amountSom} windowMinutes={windowMinutes(ins.windowSeconds)} remaining={payLeft} total={ins.windowSeconds ?? null} contactPhone={o.restaurantPhone} />}
                  <PayCard number={ins.cardNumber} holder={ins.cardHolder ?? o.restaurantName} onCopy={d => void copy(d)} />
                </div>
              )
          )}
          {ins && ins.expiresAt && payLeft === null && <p className="sub small">{t('To‘lov muddati: {time} gacha.', { time: clock(ins.expiresAt) })}</p>}
          {pay.mode === 'MOCK' && config?.mockPaymentAvailable && (
            <>
              <div className="banner">{t('Sinov rejimi: haqiqiy pul olinmaydi.')}</div>
              <Button loading={busy === 'pay'} onClick={() => void mockPay()}>{t('Sinov to‘lovini bajarish')}</Button>
            </>
          )}
          {o.stage === 'PAYMENT_PENDING' && pay.mode === 'REAL' && <p className="sub small">{t('O‘tkazgandan so‘ng bu sahifada qoling — holat o‘zi yangilanadi.')}</p>}
        </div>
      )}

      <div className="card stack">
        <h2 style={{ fontSize: 17 }}>{t('Buyurtma tarkibi')}</h2>
        {o.items.map((it, i) => <div key={i} className="row between small"><span className="grow">{it.quantity} × {it.name}</span><span className="mono">{som(it.subtotalSom)}</span></div>)}
        {(o.promoDiscountSom ?? 0) > 0 && <div className="row between small saved"><span>{t('Aksiya (1+1)')}</span><span className="mono">−{som(o.promoDiscountSom!)}</span></div>}
        <div className="divider" />
        {o.platformLine ? (<>
          <div className="row between"><span className="bold">{t('Taomlar')}</span><span className="bold mono">{som(o.foodTotalSom - o.platformLine.chargedSom)}</span></div>
          <PlatformLineRow chargedSom={o.platformLine.chargedSom} waivedSom={o.platformLine.waivedSom} />
          <div className="row between"><span className="bold">{t('Jami (taksidan tashqari)')}</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>
        </>) : <div className="row between"><span className="bold">{t('Taomlar jami')}</span><span className="bold mono">{som(o.foodTotalSom)}</span></div>}
        <TaxiFareBox selfDelivered={o.deliveryMode === 'SELF'} walk={o.deliveryPreference === 'WALK_OK' && ['PAYMENT_PENDING', 'PAYMENT_CHECKING', 'PREPARING'].includes(o.stage)} taxiName={o.taxiCompanyName ?? null} />
        <div className="sub small row" style={{ alignItems: 'flex-start' }}><Icon as={MapPin} size={16} className="shrink" /><span className="grow">{o.address}</span></div>
      </div>

      {o.cancel.allowed && !isTerminal(o.stage) && (
        <Button variant="danger" loading={busy === 'cancel'} onClick={() => setConfirmCancel(true)}>
          {o.cancel.kind === 'UNPAID' ? t('Buyurtmani bekor qilish') : t('Bekor qilish so‘rovi')}
        </Button>
      )}
      {!trouble && <Button variant="ghost" onClick={writeAbout}>{t('Muammo bormi? Yozing')}</Button>}
      {error && <div className="banner warn">{t('Yangilab bo‘lmadi. Oxirgi ma’lumot ko‘rsatilmoqda.')}</div>}

      {confirmCancel && (
        <Sheet title={t('Bekor qilishni tasdiqlang')} onClose={() => setConfirmCancel(false)}>
          <p className="sub" style={{ marginBottom: 12 }}>{o.cancel.kind === 'REFUND_REQUEST'
            ? t('To‘lov qilingan. Bekor qilish so‘rovi restoranga yuboriladi; pul qaytarilishi restoran qaroriga bog‘liq.')
            : t('Buyurtma bekor qilinadi. Pul o‘tkazgan bo‘lsangiz, bekor qilmang.')}</p>
          <div className="stack">
            <Button variant="danger" onClick={() => void cancel()}>{t('Ha, bekor qilish')}</Button>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>{t('Yo‘q')}</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export { confirmDialog };
