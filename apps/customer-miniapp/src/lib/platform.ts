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

/** A picture URL from the API. The restaurant's own uploads are relative (/api/v1/miniapp/...): in the APK they must go to the server, not to the app's local origin. */
export function mediaUrl(url: string | null | undefined, width?: number): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${apiOrigin()}${sizedUrl(url, width)}` : url;
}

/**
 * The restaurant's own uploads (/api/v1/miniapp/.../image?v=N) can be asked for a smaller copy with `&w=<pixels>`; the server picks the nearest
 * allowed width (160/320/640/1024) and falls back to the original if a copy would not be smaller. A list card needs a few dozen KB, not the original.
 */
export function sizedUrl(url: string, width?: number): string {
  if (!width || !url.startsWith('/api/v1/miniapp/') || !url.includes('/image')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}

/** Absolute API origin for the APK (set at build time, no trailing slash). The web build keeps same-origin relative URLs. */
export function apiOrigin(): string {
  if (!isAndroidApp) return '';
  const base = typeof __DS_API_BASE__ === 'string' ? __DS_API_BASE__.replace(/\/+$/, '') : '';
  if (!base) throw new Error('API_URL_MISSING');
  if (typeof __DS_RELEASE__ !== 'undefined' && __DS_RELEASE__ && !base.startsWith('https://')) throw new Error('API_URL_NOT_HTTPS');
  return base;
}
