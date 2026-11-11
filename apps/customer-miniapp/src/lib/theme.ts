import { isAndroidApp } from './platform';
import { onTelegramTheme, setTelegramColors, telegramColorScheme } from './telegram';

export type Theme = 'light' | 'dark';

/** Colours of the browser / Telegram chrome around the page: the header strip and the page background. */
export const CHROME: Record<Theme, { header: string; background: string }> = {
  light: { header: '#087F5B', background: '#F5FBF7' },
  dark: { header: '#08392B', background: '#0F1D1A' },
};

/** Inside Telegram the person's Telegram theme decides (it can differ from the phone's); everywhere else the phone's setting does. */
export function resolveTheme(telegramScheme: string | undefined, phonePrefersDark: boolean): Theme {
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

/** Sets <html data-theme> now and keeps it in step with the phone / Telegram theme. No manual switch: the mockup has none. */
export function initTheme(): void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const update = (): void => apply(resolveTheme(isAndroidApp ? undefined : telegramColorScheme(), media?.matches ?? false));
  update();
  media?.addEventListener?.('change', update);
  onTelegramTheme(update);
}
