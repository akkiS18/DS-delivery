import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button, Empty, Icon, Sheet, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { apiOrigin, isAndroidApp } from '../lib/platform';
import { confirmDialog, openExternal } from '../lib/telegram';
import type { Address } from '../lib/types';
import { formatPhone, hasErrors, normalizePhone, validateAddress } from '../lib/validation';
import { useApp } from '../state';
import { TelegramLink } from './TelegramLink';

/** The legal pages are served by the backend: the APK knows its API origin, the Mini App is served from it. */
function legalOrigin(): string {
  return isAndroidApp ? apiOrigin() : window.location.origin;
}

export function Profile() {
  const { profile, refreshProfile, toast } = useApp();
  const [phone, setPhone] = useState('');
  const [editPhone, setEditPhone] = useState(false);
  const [form, setForm] = useState<{ id: string | null; label: string; addressText: string } | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!profile) return <div className="page"><Spinner /></div>;
  const normalized = normalizePhone(phone);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await refreshProfile(); toast(ok); return true; }
    catch (e) { toast(e instanceof ApiError && e.code === 'MANZIL_LIMIT' ? 'Manzillar soni chegaraga yetdi' : 'Saqlab bo‘lmadi'); return false; }
    finally { setBusy(false); }
  };

  const savePhone = async () => {
    setTouched(true);
    if (!normalized) return;
    if (await run(() => api.setPhone(normalized), 'Telefon saqlandi')) { setEditPhone(false); setPhone(''); setTouched(false); }
  };
  const errors = form ? validateAddress({ label: form.label, addressText: form.addressText, lat: null, lng: null }) : {};
  const saveAddress = async () => {
    setTouched(true);
    if (!form || hasErrors(errors)) return;
    const body = { label: form.label.trim(), addressText: form.addressText.trim() };
    if (await run(() => (form.id ? api.updateAddress(form.id, body) : api.addAddress(body)), 'Manzil saqlandi')) { setForm(null); setTouched(false); }
  };
  const remove = async (a: Address) => {
    if (await confirmDialog(`“${a.label}” manzilini o‘chirasizmi?`)) await run(() => api.deleteAddress(a.id), 'Manzil o‘chirildi');
  };

  return (
    <div className="page">
      <h1 className="page-title">Profil</h1>
      {profile.displayName && <p className="sub">{profile.displayName}</p>}

      <TelegramLink />

      <section className="card stack" aria-label="Telefon">
        <h2 style={{ fontSize: 17 }}>Telefon raqami</h2>
        {profile.phone && !editPhone
          ? <div className="row between"><span className="bold mono">{formatPhone(profile.phone)}</span><Button small variant="ghost" onClick={() => setEditPhone(true)}>O‘zgartirish</Button></div>
          : <div className="field">
              <input className={`input ${touched && !normalized ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" value={phone} onChange={e => setPhone(e.target.value)} aria-label="Telefon raqami" />
              {touched && !normalized && <div className="err">Telefon raqamini to‘g‘ri kiriting</div>}
              <div style={{ marginTop: 8 }}><Button loading={busy} onClick={() => void savePhone()}>Saqlash</Button></div>
            </div>}
      </section>

      <section className="stack" aria-label="Manzillar">
        <div className="row between"><h2 style={{ fontSize: 17 }}>Manzillarim</h2><Button small variant="secondary" onClick={() => { setForm({ id: null, label: '', addressText: '' }); setTouched(false); }}>+ Qo‘shish</Button></div>
        {profile.addresses.length === 0 && <Empty icon={<Icon as={MapPin} size={44} />} title="Manzil saqlanmagan" hint="Buyurtma paytida ham saqlashingiz mumkin." />}
        {profile.addresses.map(a => (
          <div key={a.id} className="card stack">
            <div className="row between"><span className="bold">{a.label}</span>{a.isDefault && <span className="badge open">Asosiy</span>}</div>
            <div className="sub small">{a.addressText}</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {!a.isDefault && <Button small variant="secondary" disabled={busy} onClick={() => void run(() => api.setDefaultAddress(a.id), 'Asosiy manzil o‘zgardi')}>Asosiy qilish</Button>}
              <Button small variant="ghost" onClick={() => { setForm({ id: a.id, label: a.label, addressText: a.addressText }); setTouched(false); }}>Tahrirlash</Button>
              <Button small variant="ghost" onClick={() => void remove(a)}>O‘chirish</Button>
            </div>
          </div>
        ))}
      </section>

      <section className="row" style={{ flexWrap: 'wrap' }} aria-label="Hujjatlar">
        <Button small variant="ghost" onClick={() => void openExternal(`${legalOrigin()}/legal/privacy`)}>Maxfiylik siyosati</Button>
        <Button small variant="ghost" onClick={() => void openExternal(`${legalOrigin()}/legal/terms`)}>Foydalanish shartlari</Button>
      </section>

      {form && (
        <Sheet title={form.id ? 'Manzilni tahrirlash' : 'Yangi manzil'} onClose={() => setForm(null)}>
          <div className="stack">
            <div className="field"><label htmlFor="pl">Nomi</label>
              <input id="pl" className={`input ${touched && errors.label ? 'invalid' : ''}`} maxLength={30} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Uy, Ish..." />
              {touched && errors.label && <div className="err">{errors.label}</div>}</div>
            <div className="field"><label htmlFor="pa">Manzil</label>
              <textarea id="pa" className={`input ${touched && errors.addressText ? 'invalid' : ''}`} rows={3} maxLength={500} value={form.addressText} onChange={e => setForm({ ...form, addressText: e.target.value })} />
              {touched && errors.addressText && <div className="err">{errors.addressText}</div>}</div>
            <Button loading={busy} onClick={() => void saveAddress()}>Saqlash</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>Bekor qilish</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
