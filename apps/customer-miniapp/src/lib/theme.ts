import { isAndroidApp } from './platform';
import { onTelegramTheme, setTelegramColors, telegramColorScheme } from './telegram';

export type Theme = 'light' | 'dark';
/** What the customer chose in the profile: follow the phone / Telegram ('auto', the default) or force one theme. */
export type ThemePref = 'auto' | Theme;

/** Colours of the browser / Telegram chrome around the page: the header strip and the page background. */
export const CHROME: Record<Theme, { header: string; background: string }> = {
  light: { header: '#087F5B', background: '#F5FBF7' },
  dark: { header: '#08392B', background: '#0F1D1A' },
};

export const THEME_KEY = 'ds.theme.v1';

export function parsePref(raw: unknown): ThemePref {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/** The customer's choice, kept on the phone. Unreadable storage (private window, blocked data) simply means 'auto'. */
export function getThemePref(): ThemePref {
  try { return parsePref(window.localStorage.getItem(THEME_KEY)); } catch { return 'auto'; }
}

/**
 * An explicit choice wins. Otherwise, inside the Mini App the person's Telegram theme decides (it can differ from the phone's);
 * everywhere else the phone's setting does.
 */
export function resolveTheme(telegramScheme: string | undefined, phonePrefersDark: boolean, pref: ThemePref = 'auto'): Theme {
  if (pref === 'dark' || pref === 'light') return pref;
  if (telegramScheme === 'dark') return 'dark';
  if (telegramScheme === 'light') return 'light';
  return phonePrefersDark ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme].header);
  if (!isAndroidApp) setTelegramColors(CHROME[theme].header, CHROME[theme].background);
}

let refresh: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Saves the choice and applies it at once. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'auto') window.localStorage.removeItem(THEME_KEY); else window.localStorage.setItem(THEME_KEY, pref);
  } catch { /* the choice then lasts until the app is closed */ }
  explicit = pref;
  refresh?.();
  listeners.forEach(l => l());
}

let explicit: ThemePref | null = null;
const currentPref = (): ThemePref => explicit ?? getThemePref();

/** For a component that shows the current choice (useSyncExternalStore). */
export function subscribeTheme(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export const themePrefSnapshot = (): ThemePref => currentPref();

/** Sets <html data-theme> now and keeps it in step with the phone / Telegram theme (unless the customer forced one). */
export function initTheme(): void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const update = (): void => apply(resolveTheme(isAndroidApp ? undefined : telegramColorScheme(), media?.matches ?? false, currentPref()));
  refresh = update;
  update();
  media?.addEventListener?.('change', update);
  onTelegramTheme(update);
}
