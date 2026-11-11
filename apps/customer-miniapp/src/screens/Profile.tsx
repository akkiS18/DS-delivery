import { useState } from 'react';
import { ChevronRight, House, MapPin, Pencil, UserRound } from 'lucide-react';
import { CottonPattern } from '../components/CottonPattern';
import { LocationPicker } from '../components/LocationPicker';
import type { Route } from '../lib/router';
import { Button, Empty, Icon, Sheet, Spinner } from '../components/ui';
import type { MapState } from '../lib/mapConfig';
import { api, ApiError } from '../lib/api';
import { deletionErrorText } from '../lib/accountDeletion';
import { forgetGuestToken } from '../lib/session';
import { apiOrigin, isAndroidApp } from '../lib/platform';
import { confirmDialog, openExternal } from '../lib/telegram';
import type { Address } from '../lib/types';
import { formatPhone, hasErrors, normalizePhone, validateAddress } from '../lib/validation';
import { useApp } from '../state';
import { TelegramLink } from './TelegramLink';
import { t } from '../i18n';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';

/** The legal pages are served by the backend: the APK knows its API origin, the Mini App is served from it. */
function legalOrigin(): string {
  return isAndroidApp ? apiOrigin() : window.location.origin;
}

export function Profile({ go }: { go: (r: Route) => void }) {
  const { profile, refreshProfile, toast, dispatch } = useApp();
  const [phone, setPhone] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [form, setForm] = useState<{ id: string | null; label: string; addressText: string; lat: number | null; lng: number | null } | null>(null);
  const [mapState, setMapState] = useState<MapState>('loading');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!profile) return <div className="page"><Spinner /></div>;
  const normalized = normalizePhone(phone);
  const editing = form?.id ? profile.addresses.find(a => a.id === form.id) ?? null : null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await refreshProfile(); toast(ok); return true; }
    catch (e) { toast(e instanceof ApiError && e.code === 'MANZIL_LIMIT' ? t('Manzillar soni chegaraga yetdi') : t('Saqlab bo‘lmadi')); return false; }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    if (busy) return;
    if (!(await confirmDialog(t('Hisobingiz o‘chiriladi: ism, telefon, manzillar va yozishmalar tozalanadi. Buni qaytarib bo‘lmaydi. Davom etasizmi?')))) return;
    setBusy(true);
    try {
      await api.deleteAccount();
      if (isAndroidApp) await forgetGuestToken();
      dispatch({ type: 'clear' });
      await refreshProfile();
      toast(t('Hisobingiz o‘chirildi'));
    } catch (e) { toast(t(deletionErrorText(e))); }
    finally { setBusy(false); }
  };

  const savePhone = async () => {
    setTouched(true);
    if (!normalized) return;
    if (await run(() => api.setPhone(normalized), t('Telefon saqlandi'))) { setEditPhone(false); setPhone(''); setTouched(false); }
  };
  const errors = form ? validateAddress({ addressText: form.addressText, lat: null, lng: null }) : {};
  const saveAddress = async () => {
    setTouched(true);
    if (!form || hasErrors(errors)) return;
    const body = { addressText: form.addressText.trim(), ...(form.lat !== null && form.lng !== null ? { lat: form.lat, lng: form.lng } : {}) }; // no name: a new address is numbered by the server, an edited one keeps its name
    if (await run(() => (form.id ? api.updateAddress(form.id, body) : api.addAddress(body)), t('Manzil saqlandi'))) { setForm(null); setTouched(false); }
  };
  const remove = async (a: Address) => {
    if (!(await confirmDialog(t('“{label}” manzilini o‘chirasizmi?', { label: a.label })))) return false;
    return (await run(() => api.deleteAddress(a.id), t('Manzil o‘chirildi'))) === true;
  };

  return (
    <>
      <header className="home-head">
        <CottonPattern id="cottonProfile" />
        <div className="prof-who">
          <span className="prof-avatar" aria-hidden><Icon as={UserRound} size={30} /></span>
          <div className="prof-text">
            <h1 className="home-title prof-name">{profile.displayName || t('Profil')}</h1>
            {profile.phone && <span className="prof-phone">{formatPhone(profile.phone)}</span>}
          </div>
        </div>
        <LanguageSwitch />
      </header>
      <div className="page prof-page">
      <section className="stack" aria-label={t('Manzillar')}>
        <div className="row between"><h2 className="sec-title">{t('Manzillarim')}</h2><button type="button" className="pill-add" onClick={() => { setForm({ id: null, label: '', addressText: '', lat: null, lng: null }); setTouched(false); }}>{t('+ Qo‘shish')}</button></div>
        {profile.addresses.length === 0 && <Empty icon={<Icon as={MapPin} size={44} />} title={t('Manzil saqlanmagan')} hint={t('Buyurtma paytida ham saqlashingiz mumkin.')} />}
        {profile.addresses.map(a => (
          <article key={a.id} className={`addr-row ${a.isDefault ? 'main' : ''}`}>
            <span className="addr-row-ico" aria-hidden><Icon as={a.isDefault ? House : MapPin} size={22} /></span>
            <div className="addr-row-text">
              <span className="addr-row-name">{a.label}{a.isDefault && <span className="tbadge">{t('Asosiy manzil')}</span>}</span>
              <span className="addr-row-addr">{a.addressText}</span>
            </div>
            <button type="button" className="icon-btn" aria-label={`${a.label}: ${t('Tahrirlash')}`} onClick={() => { setForm({ id: a.id, label: a.label, addressText: a.addressText, lat: a.lat, lng: a.lng }); setTouched(false); }}><Icon as={Pencil} size={20} /></button>
          </article>
        ))}
      </section>

      <TelegramLink />

      <section className="setgroup" aria-label={t('Telefon')}>
        {profile.phone && !editPhone
          ? (
            <button type="button" className="setrow phone" onClick={() => setEditPhone(true)}>
              <span className="setrow-body"><span className="setrow-sub">{t('Telefon raqami')}</span><span className="setrow-val">{formatPhone(profile.phone)}</span></span>
              <span className="setrow-act">{t('O‘zgartirish')}</span>
            </button>
          )
          : (
            <div className="field" style={{ padding: 14 }}>
              <label className="setrow-sub" htmlFor="prof-phone">{t('Telefon raqami')}</label>
              <input id="prof-phone" className={`input ${touched && !normalized ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phone} onChange={e => setPhone(e.target.value)} />
              {touched && !normalized && <div className="err">{t('Telefon raqamini to‘g‘ri kiriting')}</div>}
              <div style={{ marginTop: 8 }}><Button loading={busy} onClick={() => void savePhone()}>{t('Saqlash')}</Button></div>
            </div>
          )}
        <span className="setrow-sep" aria-hidden />
        <button type="button" className="setrow" onClick={() => go({ name: 'reservations' })}><span className="setrow-title">{t('Bronlarim')}</span><Icon as={ChevronRight} size={20} /></button>
      </section>

      <section className="setgroup themegroup" aria-label={t('Ko‘rinish')}>
        <span className="setrow-sub">{t('Ko‘rinish')}</span>
        <ThemeSwitch />
      </section>

      <section className="setgroup" aria-label={t('Hujjatlar')}>
        <button type="button" className="setrow" onClick={() => void openExternal(`${legalOrigin()}/legal/privacy`)}><span className="setrow-title">{t('Maxfiylik siyosati')}</span><Icon as={ChevronRight} size={20} /></button>
        <span className="setrow-sep" aria-hidden />
        <button type="button" className="setrow" onClick={() => void openExternal(`${legalOrigin()}/legal/terms`)}><span className="setrow-title">{t('Foydalanish shartlari')}</span><Icon as={ChevronRight} size={20} /></button>
        <span className="setrow-sep" aria-hidden />
        <button type="button" className="setrow danger" disabled={busy} onClick={() => void deleteAccount()}><span className="setrow-title">{t('Hisobni o‘chirish')}</span></button>
      </section>
      <p className="sub small prof-note">{t('Ism, telefon, manzillar va yozishmalaringiz o‘chiriladi. Buyurtmalar tarixi shaxsingizsiz hisob-kitob uchun saqlanadi.')} <button type="button" className="linkbtn" onClick={() => void openExternal(`${legalOrigin()}/legal/delete-account`)}>{t('Batafsil')}</button></p>

      {form && (
        <Sheet title={form.id ? t('Manzilni tahrirlash') : t('Yangi manzil')} onClose={() => setForm(null)}>
          <div className="stack">
            <div className="field"><label htmlFor="pa">{t('Manzil')}</label>
              <textarea id="pa" className={`input ${touched && errors.addressText ? 'invalid' : ''}`} rows={3} maxLength={500} value={form.addressText} onChange={e => setForm({ ...form, addressText: e.target.value })} />
              {touched && errors.addressText && <div className="err">{errors.addressText}</div>}</div>
            {mapState !== 'failed' && (
              <LocationPicker value={form.lat !== null && form.lng !== null ? { lat: form.lat, lng: form.lng } : null}
                onPick={p => setForm(f => (f ? { ...f, lat: p.lat, lng: p.lng } : f))} onState={setMapState} />
            )}
            <Button loading={busy} onClick={() => void saveAddress()}>{t('Saqlash')}</Button>
            {editing && !editing.isDefault && <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.setDefaultAddress(editing.id), t('Asosiy manzil o‘zgardi')).then(ok => { if (ok) setForm(null); })}>{t('Asosiy qilish')}</Button>}
            <Button variant="secondary" onClick={() => setForm(null)}>{t('Bekor qilish')}</Button>
            {editing && <Button variant="ghost" disabled={busy} onClick={() => void remove(editing).then(ok => { if (ok) setForm(null); })}>{t('O‘chirish')}</Button>}
          </div>
        </Sheet>
      )}
      </div>
    </>
  );
}
