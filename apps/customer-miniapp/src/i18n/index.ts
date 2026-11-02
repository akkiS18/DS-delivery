import { useSyncExternalStore } from 'react';
import { RU, UZ_CYRL_OVERRIDES } from './dictionary';
import { uzLatinToCyrillic } from './translit';

/**
 * The app's languages. The source text of every screen is Uzbek Latin and IS the translation key: t('Restoran qidirish') returns that very text in
 * Uzbek, its Cyrillic spelling (generated, translit.ts) or the Russian line from the dictionary. A text missing from the dictionary shows in
 * Uzbek Latin, never as an empty label or a key name; tests/i18n.test.ts fails the build for every missing entry.
 *
 * Placeholders are written {name} and filled from the second argument:  t('{n} ta taom', { n: 3 }).
 */
export type Lang = 'uz' | 'uz-Cyrl' | 'ru';
export const LANGS: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: 'uz', label: 'O‘zbekcha' },
  { code: 'uz-Cyrl', label: 'Ўзбекча' },
  { code: 'ru', label: 'Русский' },
];
export const DEFAULT_LANG: Lang = 'uz';
const KEY = 'ds.lang.v1';
const isLang = (x: unknown): x is Lang => x === 'uz' || x === 'uz-Cyrl' || x === 'ru';

/** One language tag from the device (navigator.language, Telegram's language_code) -> ours, or null when it is none of the three. */
export function langFromTag(tag: string | null | undefined): Lang | null {
  const t = (tag ?? '').toLowerCase().replace(/_/g, '-');
  if (t === 'ru' || t.startsWith('ru-')) return 'ru';
  if (t === 'uz-cyrl' || t.startsWith('uz-cyrl-')) return 'uz-Cyrl';
  if (t === 'uz' || t.startsWith('uz-')) return 'uz';
  return null;
}

/**
 * The language to start in: the customer's own choice (saved) first; otherwise the first of the device's languages that the app has; otherwise
 * Telegram's own language; otherwise Uzbek.
 */
export function pickLang(saved: string | null | undefined, deviceTags: readonly string[], telegramTag?: string | null): Lang {
  if (isLang(saved)) return saved;
  for (const tag of deviceTags) { const l = langFromTag(tag); if (l) return l; }
  return langFromTag(telegramTag) ?? DEFAULT_LANG;
}

const readSaved = (): string | null => { try { return window.localStorage.getItem(KEY); } catch { return null; } };
const deviceTags = (): string[] => {
  if (typeof navigator === 'undefined') return [];
  return [...(navigator.languages ?? []), navigator.language].filter((x): x is string => typeof x === 'string' && x !== '');
};
/** Display preference only; never used for authentication (that is the signed initData). */
const telegramTag = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
};

let current: Lang = pickLang(readSaved(), deviceTags(), telegramTag());
const listeners = new Set<() => void>();

function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current === 'uz-Cyrl' ? 'uz-Cyrl' : current;
}
applyToDocument();

export const getLang = (): Lang => current;
export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try { window.localStorage.setItem(KEY, l); } catch { /* storage blocked: the choice lasts until the app closes */ }
  applyToDocument();
  listeners.forEach(fn => fn());
}
/** Re-renders the component when the language changes. Screens remount on a change (App keys <main> on the language). */
export function useLang(): Lang {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getLang, () => DEFAULT_LANG);
}

const cyrlCache = new Map<string, string>();
const cyrl = (key: string): string => {
  const hit = cyrlCache.get(key);
  if (hit !== undefined) return hit;
  const v = UZ_CYRL_OVERRIDES[key] ?? uzLatinToCyrillic(key);
  cyrlCache.set(key, v);
  return v;
};

/** Translate a text written in Uzbek Latin into the current language. */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let s = lang === 'ru' ? (RU[key] ?? key) : lang === 'uz-Cyrl' ? cyrl(key) : key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m));
  return s;
}
export const t = (key: string, params?: Record<string, string | number>): string => translate(current, key, params);

/**
 * Marks a text that is stored in a constant (labels in a table) and shown later through t(). It returns the text unchanged; its only job is to
 * let tests/i18n.test.ts see the text and demand its translations:  const LABEL = { A: T('Yuborildi') };  ...  t(LABEL.A)
 */
export const T = (key: string): string => key;
