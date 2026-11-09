import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { LocationPicker } from '../components/LocationPicker';
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

/** The legal pages are served by the backend: the APK knows its API origin, the Mini App is served from it. */
function legalOrigin(): string {
  return isAndroidApp ? apiOrigin() : window.location.origin;
}

export function Profile() {
  const { profile, refreshProfile, toast, dispatch } = useApp();
  const [phone, setPhone] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [form, setForm] = useState<{ id: string | null; label: string; addressText: string; lat: number | null; lng: number | null } | null>(null);
  const [mapState, setMapState] = useState<MapState>('loading');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!profile) return <div className="page"><Spinner /></div>;
  const normalized = normalizePhone(phone);

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
    if (await confirmDialog(t('“{label}” manzilini o‘chirasizmi?', { label: a.label }))) await run(() => api.deleteAddress(a.id), t('Manzil o‘chirildi'));
  };

  return (
    <div className="page">
      <h1 className="page-title">{t('Profil')}</h1>
      <LanguageSwitch />
      {profile.displayName && <p className="sub">{profile.displayName}</p>}

      <TelegramLink />

      <section className="card stack" aria-label={t('Telefon')}>
        <h2 style={{ fontSize: 17 }}>{t('Telefon raqami')}</h2>
        {profile.phone && !editPhone
          ? <div className="row between"><span className="bold mono">{formatPhone(profile.phone)}</span><Button small variant="ghost" onClick={() => setEditPhone(true)}>{t('O‘zgartirish')}</Button></div>
          : <div className="field">
              <input className={`input ${touched && !normalized ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phone} onChange={e => setPhone(e.target.value)} aria-label={t('Telefon raqami')} />
              {touched && !normalized && <div className="err">{t('Telefon raqamini to‘g‘ri kiriting')}</div>}
              <div style={{ marginTop: 8 }}><Button loading={busy} onClick={() => void savePhone()}>{t('Saqlash')}</Button></div>
            </div>}
      </section>

      <section className="stack" aria-label={t('Manzillar')}>
        <div className="row between"><h2 style={{ fontSize: 17 }}>{t('Manzillarim')}</h2><Button small variant="secondary" onClick={() => { setForm({ id: null, label: '', addressText: '', lat: null, lng: null }); setTouched(false); }}>{t('+ Qo‘shish')}</Button></div>
        {profile.addresses.length === 0 && <Empty icon={<Icon as={MapPin} size={44} />} title={t('Manzil saqlanmagan')} hint={t('Buyurtma paytida ham saqlashingiz mumkin.')} />}
        {profile.addresses.map(a => (
          <div key={a.id} className="card stack">
            <div className="row between"><span className="bold">{a.label}</span>{a.isDefault && <span className="badge open">{t('Asosiy')}</span>}</div>
            <div className="sub small">{a.addressText}</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {!a.isDefault && <Button small variant="secondary" disabled={busy} onClick={() => void run(() => api.setDefaultAddress(a.id), t('Asosiy manzil o‘zgardi'))}>{t('Asosiy qilish')}</Button>}
              <Button small variant="ghost" onClick={() => { setForm({ id: a.id, label: a.label, addressText: a.addressText, lat: a.lat, lng: a.lng }); setTouched(false); }}>{t('Tahrirlash')}</Button>
              <Button small variant="ghost" onClick={() => void remove(a)}>{t('O‘chirish')}</Button>
            </div>
          </div>
        ))}
      </section>

      <section className="row" style={{ flexWrap: 'wrap' }} aria-label={t('Hujjatlar')}>
        <Button small variant="ghost" onClick={() => void openExternal(`${legalOrigin()}/legal/privacy`)}>{t('Maxfiylik siyosati')}</Button>
        <Button small variant="ghost" onClick={() => void openExternal(`${legalOrigin()}/legal/terms`)}>{t('Foydalanish shartlari')}</Button>
      </section>

      <section className="card stack" aria-label={t('Hisobni o‘chirish')}>
        <h2 style={{ fontSize: 17 }}>{t('Hisobni o‘chirish')}</h2>
        <p className="sub small">{t('Ism, telefon, manzillar va yozishmalaringiz o‘chiriladi. Buyurtmalar tarixi shaxsingizsiz hisob-kitob uchun saqlanadi.')}</p>
        <Button small variant="secondary" disabled={busy} onClick={() => void deleteAccount()}>{t('Hisobni o‘chirish')}</Button>
        <Button small variant="ghost" onClick={() => void openExternal(`${legalOrigin()}/legal/delete-account`)}>{t('Batafsil')}</Button>
      </section>

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
            <Button variant="secondary" onClick={() => setForm(null)}>{t('Bekor qilish')}</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
