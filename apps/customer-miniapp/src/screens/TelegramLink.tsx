import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Sheet, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { isAndroidApp } from '../lib/platform';
import { storeGuestToken } from '../lib/session';
import { openExternal } from '../lib/telegram';
import type { LinkStatus } from '../lib/types';
import { useApp } from '../state';

const POLL_MS = 3000;
const LIVE = ['CREATED', 'BOT_BOUND', 'BOT_CONFIRMED'];

/**
 * Optional "link Telegram" for the Android guest. The deep link only opens the bot; nothing is linked until the person confirms in
 * Telegram AND here, after seeing which Telegram account is about to be attached.
 */
export function TelegramLink() {
  const { profile, reload, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<(LinkStatus & { deepLink: string }) | null>(null);
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
    } catch (e) { if (alive.current && e instanceof ApiError && e.status === 404) setProblem('Bog‘lash topilmadi. Qaytadan boshlang.'); }
  }, [link]);

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
    return <section className="card stack" aria-label="Telegram"><div className="row between"><span className="bold">Telegram</span><span className="badge open">Bog‘langan</span></div></section>;
  }

  const begin = async () => {
    if (busy) return;
    setBusy(true); setProblem(null); setStatus(null);
    try {
      const created = await api.startTelegramLink();
      setLink(created); setOpen(true);
      await openExternal(created.deepLink);
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'TELEGRAM_LINK_NOT_CONFIGURED' ? 'Telegramga bog‘lash hozircha sozlanmagan' : 'Telegramni ochib bo‘lmadi');
    } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); };
  const cancel = async () => {
    if (link && status && LIVE.includes(status.status)) { try { await api.cancelTelegramLink(link.id); } catch { /* it expires by itself */ } }
    setOpen(false); setLink(null); setStatus(null);
  };
  const confirm = async () => {
    if (!link || busy) return;
    setBusy(true); setProblem(null);
    try {
      const r = await api.confirmTelegramLink(link.id);
      if (r.session) await storeGuestToken(r.session.token); // the server rotated the credential: keep the new one
      toast('Telegram bog‘landi');
      setOpen(false); setLink(null); setStatus(null);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError && (e.code === 'LINK_EXPIRED' || e.code === 'LINK_CLOSED') ? 'Bog‘lash muddati tugagan. Qaytadan boshlang.' : 'Bog‘lab bo‘lmadi. Qayta urinib ko‘ring.');
    } finally { setBusy(false); }
  };

  const state = status?.status ?? link?.status ?? 'CREATED';
  const dead = state === 'EXPIRED' || state === 'CANCELLED';
  return (
    <>
      <section className="card stack" aria-label="Telegram">
        <h2 style={{ fontSize: 17 }}>Telegram</h2>
        <p className="sub small">Buyurtmalaringizni boshqa qurilmada tiklash uchun Telegramga bog‘lang.</p>
        <Button variant="secondary" loading={busy && !open} onClick={() => void begin()}>Telegramga bog‘lash</Button>
      </section>
      {open && (
        <Sheet title="Telegramga bog‘lash" onClose={close}>
          <div className="stack">
            {problem && <div className="err" role="alert">{problem}</div>}
            {!dead && state !== 'BOT_CONFIRMED' && (
              <>
                <p className="sub">Telegramda DS Delivery botini oching va “Ha, bog‘lash” tugmasini bosing. Keyin shu yerga qayting.</p>
                <div className="row"><Spinner /><span className="sub small">Telegram tasdig‘i kutilmoqda…</span></div>
                {link && <Button variant="ghost" onClick={() => void openExternal(link.deepLink)}>Telegramni qayta ochish</Button>}
              </>
            )}
            {state === 'BOT_CONFIRMED' && (
              <>
                <p className="sub">Ushbu Telegram akkaunt ulanadi:</p>
                <div className="card"><div className="bold">{status?.telegram?.name ?? 'Telegram foydalanuvchisi'}</div>{status?.telegram?.username && <div className="sub small">@{status.telegram.username}</div>}</div>
                {status?.existingAccount && <p className="sub small">Bu akkauntda oldingi buyurtmalar bor. Tasdiqlasangiz, shu qurilmadagi buyurtma va manzillar unga qo‘shiladi.</p>}
                <Button loading={busy} onClick={() => void confirm()}>Ha, bu mening akkauntim</Button>
              </>
            )}
            {dead && <p className="sub">{state === 'EXPIRED' ? 'Muddat tugadi.' : 'Bog‘lash bekor qilindi.'} Qaytadan urinib ko‘ring.</p>}
            <Button variant="ghost" onClick={() => void (dead ? Promise.resolve(close()) : cancel())}>{dead ? 'Yopish' : 'Bekor qilish'}</Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
