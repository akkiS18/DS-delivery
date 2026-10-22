import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/telegram', () => ({ getInitData: () => 'query_id=test&hash=00' }));

let calls: Array<{ method: string; headers: Record<string, string>; body: string | undefined }> = [];
beforeEach(() => {
  vi.resetModules();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ method: init.method, headers: init.headers, body: init.body });
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
  }));
});

describe('request bodies', () => {
  it('bodiless POST/PUT/DELETE calls send an explicit JSON {} (the native Android HTTP layer would otherwise send form-urlencoded and get 415)', async () => {
    const { api } = await import('../src/lib/api');
    await api.startTelegramLink();
    await api.mockPay('o1');
    await api.confirmTelegramLink('l1');
    await api.setDefaultAddress('a1');
    await api.deleteAddress('a1').catch(() => undefined);
    expect(calls.map(c => c.method)).toEqual(['POST', 'POST', 'POST', 'POST', 'DELETE']);
    for (const c of calls) {
      expect(c.headers['Content-Type']).toBe('application/json');
      expect(c.body).toBe('{}');
    }
  });

  it('GET requests carry no body or Content-Type, and real bodies are untouched', async () => {
    const { api } = await import('../src/lib/api');
    await api.me();
    await api.setPhone('+998900000000');
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[0]!.headers['Content-Type']).toBeUndefined();
    expect(JSON.parse(calls[1]!.body!)).toEqual({ phone: '+998900000000' });
  });
});
