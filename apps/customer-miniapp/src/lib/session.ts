import { registerPlugin } from '@capacitor/core';
import { ApiError } from './apiError';
import { apiOrigin } from './platform';

/**
 * Android guest session. The credential is issued by the server (32 random bytes) and kept ONLY in the platform's protected store
 * (Android Keystore-backed AES-GCM, see SecureStorePlugin.java) - never localStorage, never logs, never a URL.
 * The installation id is a random label for support; it is not a credential and the server grants nothing for it.
 */
interface SecureStorePlugin {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
}
export const SecureStore = registerPlugin<SecureStorePlugin>('SecureStore');

const TOKEN_KEY = 'ds.guest.token';
const INSTALL_KEY = 'ds.install.id';

let cached: string | null = null;
let inflight: Promise<string> | null = null;

async function installationId(): Promise<string> {
  const existing = (await SecureStore.get({ key: INSTALL_KEY })).value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  await SecureStore.set({ key: INSTALL_KEY, value: id });
  return id;
}

async function bootstrap(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}/api/v1/miniapp/guest/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ installationId: await installationId() }),
    });
  } catch { throw new ApiError(0, 'NETWORK'); }
  if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'TOO_MANY_REQUESTS' : `HTTP_${res.status}`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token.startsWith('dsg_')) throw new ApiError(502, 'BAD_SESSION_RESPONSE');
  return body.token;
}

/**
 * The stored credential, or - on the very first launch - a freshly created guest. Concurrent callers (the app fires several requests on open,
 * React StrictMode mounts twice) share ONE bootstrap, so a single launch creates a single guest profile.
 */
export function getGuestToken(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  inflight ??= (async () => {
    const stored = (await SecureStore.get({ key: TOKEN_KEY })).value;
    if (stored) return (cached = stored);
    const token = await bootstrap();
    try { await SecureStore.set({ key: TOKEN_KEY, value: token }); }
    catch { throw new ApiError(0, 'STORAGE'); } // an unsaved guest would be orphaned on every launch: refuse instead
    return (cached = token);
  })().finally(() => { inflight = null; });
  return inflight;
}

/** After the server rotates the credential (Telegram link completed). */
export async function storeGuestToken(token: string): Promise<void> {
  await SecureStore.set({ key: TOKEN_KEY, value: token });
  cached = token;
}

/** The server refused this credential (expired / revoked): forget it so the next call starts a new guest. */
export async function dropGuestToken(bad: string): Promise<void> {
  if (cached === bad) cached = null;
  const stored = (await SecureStore.get({ key: TOKEN_KEY })).value;
  if (stored === bad) await SecureStore.remove({ key: TOKEN_KEY });
}

/** The account was deleted: forget the credential so the next call starts a brand-new guest. */
export async function forgetGuestToken(): Promise<void> {
  cached = null;
  await SecureStore.remove({ key: TOKEN_KEY });
}
