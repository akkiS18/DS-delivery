import { Capacitor } from '@capacitor/core';

/**
 * Which container the UI runs in. This only selects UI behaviour and which credential the client sends; it is never sent to the server as
 * a trust signal (the backend decides from the credential: a verified Telegram signature or a server-issued guest session).
 *
 *  - telegram: inside the Telegram Mini App (unchanged behaviour, initData auth)
 *  - android:  the Capacitor APK. Requires BOTH the android build target (compile-time) AND the native runtime, so the Vercel web build can
 *              never switch into guest mode by faking a global.
 *  - browser:  a plain browser; keeps the existing "open in Telegram" protection.
 */

export const isAndroidApp: boolean = (typeof __DS_TARGET__ !== 'undefined' && __DS_TARGET__ === 'android') && Capacitor.isNativePlatform();

/** Absolute API origin for the APK (set at build time, no trailing slash). The web build keeps same-origin relative URLs. */
export function apiOrigin(): string {
  if (!isAndroidApp) return '';
  const base = typeof __DS_API_BASE__ === 'string' ? __DS_API_BASE__.replace(/\/+$/, '') : '';
  if (!base) throw new Error('API_URL_MISSING');
  if (typeof __DS_RELEASE__ !== 'undefined' && __DS_RELEASE__ && !base.startsWith('https://')) throw new Error('API_URL_NOT_HTTPS');
  return base;
}
