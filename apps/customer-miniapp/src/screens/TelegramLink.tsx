import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Sheet, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { isAndroidApp } from '../lib/platform';
import { storeGuestToken } from '../lib/session';
import { openExternal } from '../lib/telegram';
import type { LinkStatus } from '../lib/types';
import { useApp } from '../state';
import { t } from '../i18n';

const POLL_MS = 3000;
const LIVE = ['CREATED', 'BOT_BOUND', 'BOT_CONFIRMED'];
const PENDING_KEY = 'ds.tgLink.v1';

type Pending = LinkStatus & { deepLink: string };

/**
 * The attempt in progress, kept on the phone: opening Telegram sends the app to the background, and coming back reloads the screen (and an
 * Android phone may even restart the page). Without this the customer returned to a blank profile and the confirmation step was lost.
 */
function loadPending(): Pending | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (!p || typeof p.id !== 'string' || typeof p.deepLink !== 'string' || !(Date.parse(p.expiresAt) > Date.now())) { window.localStorage.removeItem(PENDING_KEY); return null; }
    return p;
  } catch { return null; }
}
const savePending = (p: Pending | null): void => {
  try { if (p) window.localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else window.localStorage.removeItem(PENDING_KEY); } catch { /* the sheet then lives until the screen reloads */ }
};

/**
 * Optional "link Telegram" for the Android guest. The deep link only opens the bot; nothing is linked until the person confirms in
 * Telegram AND here, after seeing which Telegram account is about to be attached.
 */
export function TelegramLink() {
  const { profile, reload, toast } = useApp();
  const [link, setLink] = useState<Pending | null>(loadPending);
  const [open, setOpen] = useState(() => link !== null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const poll = useCallback(async () => {
    if (!link) return;
    try {
      const s = await api.telegramLink(link.id);
      if (alive.current) setStatus(s);
    } catch (e) { if (alive.current && e instanceof ApiError && e.status === 404) setProblem(t('Bog‘lash topilmadi. Qaytadan boshlang.')); }
  }, [link]);

  // Back from Telegram with an attempt in progress: ask for its state at once instead of waiting for the first tick.
  useEffect(() => { if (link) void poll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bounded polling: every few seconds while the sheet is open, the app is visible and the attempt is live; stops at expiry.
  useEffect(() => {
    if (!open || !link || (status && !LIVE.includes(status.status))) return;
    const expires = Date.parse(link.expiresAt);
    const tick = () => { if (!document.hidden && Date.now() < expires + 5000) void poll(); };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [open, link, status, poll]);

  if (!isAndroidApp || !profile) return null;
  if (profile.telegramLinked) {
    return <section className="card stack" aria-label="Telegram"><div className="row between"><span className="bold">Telegram</span><span className="badge open">{t('Bog‘langan')}</span></div></section>;
  }

  const begin = async () => {
    if (busy) return;
    setBusy(true); setProblem(null); setStatus(null);
    try {
      const created = await api.startTelegramLink();
      setLink(created); savePending(created); setOpen(true);
      await openExternal(created.deepLink);
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'TELEGRAM_LINK_NOT_CONFIGURED' ? t('Telegramga bog‘lash hozircha sozlanmagan') : t('Telegramni ochib bo‘lmadi'));
    } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); savePending(null); }; // closed on purpose: a screen reload must not bring the sheet back
  const cancel = async () => {
    if (link && status && LIVE.includes(status.status)) { try { await api.cancelTelegramLink(link.id); } catch { /* it expires by itself */ } }
    setOpen(false); setLink(null); setStatus(null); savePending(null);
  };
  const confirm = async () => {
    if (!link || busy) return;
    setBusy(true); setProblem(null);
    try {
      const r = await api.confirmTelegramLink(link.id);
      if (r.session) await storeGuestToken(r.session.token); // the server rotated the credential: keep the new one
      toast(t('Telegram bog‘landi'));
      setOpen(false); setLink(null); setStatus(null); savePending(null);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError && (e.code === 'LINK_EXPIRED' || e.code === 'LINK_CLOSED') ? t('Bog‘lash muddati tugagan. Qaytadan boshlang.') : t('Bog‘lab bo‘lmadi. Qayta urinib ko‘ring.'));
    } finally { setBusy(false); }
  };

  const state = status?.status ?? link?.status ?? 'CREATED';
  const dead = state === 'EXPIRED' || state === 'CANCELLED';
  return (
    <>
      <section className="card stack" aria-label="Telegram">
        <h2 style={{ fontSize: 17 }}>Telegram</h2>
        <p className="sub small">{t('Buyurtmalaringizni boshqa qurilmada tiklash uchun Telegramga bog‘lang.')}</p>
        <Button variant="secondary" loading={busy && !open} onClick={() => void begin()}>{t('Telegramga bog‘lash')}</Button>
      </section>
      {open && (
        <Sheet title={t('Telegramga bog‘lash')} onClose={close}>
          <div className="stack">
            {problem && <div className="err" role="alert">{problem}</div>}
            {!dead && state !== 'BOT_CONFIRMED' && (
              <>
                <p className="sub">{t('Telegramda DS Delivery botini oching va “Ha, bog‘lash” tugmasini bosing. Keyin shu yerga qayting.')}</p>
                <div className="row"><Spinner /><span className="sub small">{t('Telegram tasdig‘i kutilmoqda…')}</span></div>
                {link && <Button variant="ghost" onClick={() => void openExternal(link.deepLink)}>{t('Telegramni qayta ochish')}</Button>}
              </>
            )}
            {state === 'BOT_CONFIRMED' && (
              <>
                <p className="sub">{t('Ushbu Telegram akkaunt ulanadi:')}</p>
                <div className="card"><div className="bold">{status?.telegram?.name ?? t('Telegram foydalanuvchisi')}</div>{status?.telegram?.username && <div className="sub small">@{status.telegram.username}</div>}</div>
                {status?.existingAccount && <p className="sub small">{t('Bu akkauntda oldingi buyurtmalar bor. Tasdiqlasangiz, shu qurilmadagi buyurtma va manzillar unga qo‘shiladi.')}</p>}
                <Button loading={busy} onClick={() => void confirm()}>{t('Ha, bu mening akkauntim')}</Button>
              </>
            )}
            {dead && <p className="sub">{state === 'EXPIRED' ? t('Muddat tugadi.') : t('Bog‘lash bekor qilindi.')} {t('Qaytadan urinib ko‘ring.')}</p>}
            <Button variant="ghost" onClick={() => void (dead ? Promise.resolve(close()) : cancel())}>{dead ? t('Yopish') : t('Bekor qilish')}</Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
