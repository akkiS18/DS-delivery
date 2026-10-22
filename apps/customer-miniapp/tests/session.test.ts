import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the Keystore-backed SecureStore plugin and for the network.
const store = new Map<string, string>();
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  }),
}));

const token = (n: number) => `dsg_${String(n).padStart(43, 'A')}`;
let calls: Array<{ url: string; body: string }> = [];
let counter = 0;
beforeEach(() => {
  vi.resetModules();
  store.clear(); calls = []; counter = 0;
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-3333-4444-555555555555' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    await new Promise(r => setTimeout(r, 5));
    return { ok: true, status: 201, json: async () => ({ token: token(++counter) }) };
  }));
});

describe('guest session (Android)', () => {
  it('parallel first-launch callers share ONE bootstrap and the credential is stored in the protected store', async () => {
    const { getGuestToken } = await import('../src/lib/session');
    const [a, b, c] = await Promise.all([getGuestToken(), getGuestToken(), getGuestToken()]);
    expect(a).toBe(token(1)); expect(b).toBe(a); expect(c).toBe(a);
    expect(calls).toHaveLength(1);
    expect(store.get('ds.guest.token')).toBe(a);
    expect(JSON.parse(calls[0]!.body)).toEqual({ installationId: '11111111-2222-3333-4444-555555555555' }); // a label, not a credential
  });

  it('a stored credential is restored without any network call (reopen)', async () => {
    store.set('ds.guest.token', token(9));
    const { getGuestToken } = await import('../src/lib/session');
    expect(await getGuestToken()).toBe(token(9));
    expect(calls).toHaveLength(0);
  });

  it('a credential the server refused is dropped so the next call starts a new guest; a newer stored one is kept', async () => {
    const { getGuestToken, dropGuestToken, storeGuestToken } = await import('../src/lib/session');
    const first = await getGuestToken();
    await dropGuestToken(first);
    expect(store.has('ds.guest.token')).toBe(false);
    const second = await getGuestToken();
    expect(second).not.toBe(first);
    await storeGuestToken(token(50));            // rotated by the server after a Telegram link
    await dropGuestToken(second);                // a late 401 for the OLD token must not erase the new one
    expect(store.get('ds.guest.token')).toBe(token(50));
  });

  it('a failed bootstrap is retried on the next call and nothing is stored', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error('offline'); });
    const { getGuestToken } = await import('../src/lib/session');
    await expect(getGuestToken()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.has('ds.guest.token')).toBe(false);
    expect(await getGuestToken()).toBe(token(1));
  });
});
