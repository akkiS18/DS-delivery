import { t } from '../i18n';

/** Input rules mirror the backend (profile.ts / contract.ts); the server stays the authority and re-validates everything. */

/** Accepts the ways Uzbek numbers are typed and returns the canonical +998XXXXXXXXX, or null. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  const d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.length === 9) return `+998${d}`;                       // 90 123 45 67
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;  // 998901234567 / +998901234567
  return null;
}

export const formatPhone = (phone: string): string => {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
};

/** The name is optional: the server numbers it ("Manzil 1", "Manzil 2"). When one is given it is still checked. */
export interface AddressForm { label?: string; addressText: string; lat: number | null; lng: number | null }
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateAddress(f: AddressForm): FieldErrors<'label' | 'addressText'> {
  const errors: FieldErrors<'label' | 'addressText'> = {};
  const text = f.addressText.trim();
  if (f.label !== undefined) {
    const label = f.label.trim();
    if (label.length < 1) errors.label = t('Nom kiriting (masalan: Uy)');
    else if (label.length > 30) errors.label = t('Nom 30 belgidan oshmasin');
  }
  if (text.length < 3) errors.addressText = t('Manzilni to‘liqroq yozing (kamida 3 belgi)');
  else if (text.length > 500) errors.addressText = t('Manzil 500 belgidan oshmasin');
  return errors;
}

export const hasErrors = (e: object): boolean => Object.keys(e).length > 0;

/** Checkout needs a usable address and phone before the button is enabled. */
export function checkoutReady(input: { addressText: string | null; phone: string | null }): { ok: boolean; missing: Array<'address' | 'phone'> } {
  const missing: Array<'address' | 'phone'> = [];
  if (!input.addressText || input.addressText.trim().length < 3) missing.push('address');
  if (!input.phone || !/^\+998\d{9}$/.test(input.phone)) missing.push('phone');
  return { ok: missing.length === 0, missing };
}
