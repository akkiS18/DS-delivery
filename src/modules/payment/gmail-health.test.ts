import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_BACKOFF_MS, GmailHealth, backoffMs, classifyGmailError, isFreshIncoming } from './gmail-health.js';
import { gmailAlertSender, renderGmailAlert } from '../../bot/gmail-alerts.js';

describe('classifyGmailError', () => {
  it('separates auth, config, network and api failures', () => {
    assert.equal(classifyGmailError('Google OAuth: invalid_grant'), 'auth');
    assert.equal(classifyGmailError('Gmail 401: {"error":"invalid credentials"}'), 'auth');
    assert.equal(classifyGmailError('Refresh token yo‘q; gmail-token.json ni zaxiralab qayta OAuth qiling.'), 'auth');
    assert.equal(classifyGmailError('GMAIL_TOKEN_FILE yo‘q: ruxsatni lokal kompyuterda bering'), 'config');
    assert.equal(classifyGmailError('GMAIL_CREDENTIALS_FILE o‘qilmadi'), 'config');
    assert.equal(classifyGmailError('GMAIL_FROM haqiqiy UZCARD yuboruvchi e-mail bo‘lsin.'), 'config');
    assert.equal(classifyGmailError('fetch failed'), 'network');
    assert.equal(classifyGmailError('getaddrinfo ENOTFOUND gmail.googleapis.com'), 'network');
    assert.equal(classifyGmailError('Gmail 503: backend error'), 'api');
    assert.equal(classifyGmailError('Gmail 429: rate limit'), 'api');
    assert.equal(classifyGmailError('Gmail 403: User-rate limit exceeded'), 'api');
    assert.equal(classifyGmailError('Gmail 403: Request had insufficient authentication scopes'), 'auth');
  });
});

describe('backoffMs', () => {
  it('is zero without failures, doubles, and is capped at 5 minutes', () => {
    assert.equal(backoffMs(0, 12_000), 0);
    assert.equal(backoffMs(1, 12_000), 24_000);
    assert.equal(backoffMs(2, 12_000), 48_000);
    assert.equal(backoffMs(50, 12_000), MAX_BACKOFF_MS);
  });
});

describe('GmailHealth', () => {
  it('is disabled until enabled and starting until the first poll finishes', () => {
    const h = new GmailHealth();
    assert.equal(h.status(0), 'disabled');
    h.enable(12_000);
    assert.equal(h.status(0), 'starting');
    h.succeeded(1000);
    assert.equal(h.status(2000), 'ok');
  });
  it('degrades on a transient failure and goes down after 3, announcing DOWN once and RECOVERED once', () => {
    const h = new GmailHealth(); h.enable(12_000); h.succeeded(0);
    assert.equal(h.failed('network', 1000), null);
    assert.equal(h.status(1000), 'degraded');
    assert.equal(h.failed('network', 2000), null);
    assert.equal(h.failed('network', 3000), 'DOWN');
    assert.equal(h.status(3000), 'down');
    assert.equal(h.failed('network', 4000), null, 'no second DOWN while it stays down');
    assert.equal(h.succeeded(5000), 'RECOVERED');
    assert.equal(h.succeeded(6000), null);
    assert.equal(h.status(6000), 'ok');
  });
  it('an auth or config failure is down at once (retrying cannot fix it)', () => {
    for (const kind of ['auth', 'config'] as const) {
      const h = new GmailHealth(); h.enable(12_000); h.succeeded(0);
      assert.equal(h.failed(kind, 1000), 'DOWN');
      assert.equal(h.status(1000), 'down');
    }
  });
  it('a startup failure (no poll ever succeeded) is reported', () => {
    const h = new GmailHealth(); h.enable(12_000);
    assert.equal(h.failed('config', 0), 'DOWN');
  });
  it('a poll loop that silently stops (no success for a long time) becomes down', () => {
    const h = new GmailHealth(); h.enable(12_000); h.succeeded(0);
    assert.equal(h.status(60_000), 'ok');
    assert.equal(h.status(400_000), 'down');
  });
});

describe('isFreshIncoming', () => {
  it('alerts only for recent mail, not for the 24 h re-read after a restart', () => {
    const now = Date.UTC(2026, 9, 23, 12, 0, 0);
    assert.equal(isFreshIncoming(now - 60_000, now), true);
    assert.equal(isFreshIncoming(now - 2 * 3600_000, now), false);
    assert.equal(isFreshIncoming(now + 3600_000, now), false);
    assert.equal(isFreshIncoming(Number.NaN, now), false);
  });
});

describe('admin alerts', () => {
  it('texts carry amounts, last4 and reason codes only', () => {
    const text = renderGmailAlert({ type: 'REVIEW', reason: 'LATE_FOR_EXPIRED_PAYMENT', amountTiyin: 2_100_000n, cardLast4: '8167' });
    assert.match(text, /21,000 so‘m/);
    assert.match(text, /\*\*\*8167/);
    assert.match(text, /LATE_FOR_EXPIRED_PAYMENT/);
    assert.match(renderGmailAlert({ type: 'DOWN', failure: 'auth' }), /Google ruxsati/);
    assert.match(renderGmailAlert({ type: 'RECOVERED' }), /tiklandi/);
  });
  it('sends to every admin, survives a failing send, and never throws', async () => {
    const saved = { a: process.env.SUPPORT_ADMIN_1_TELEGRAM_ID, b: process.env.SUPPORT_ADMIN_2_TELEGRAM_ID };
    process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = '111'; process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = '222';
    try {
      const sent: string[] = [];
      const logs: string[] = [];
      const bot = { telegram: { async sendMessage(id: string) { if (id === '111') throw new Error('blocked by user'); sent.push(id); } } };
      await gmailAlertSender(bot, l => logs.push(l))({ type: 'RECOVERED' });
      assert.deepEqual(sent, ['222']);
      assert.equal(logs.length, 1);
      await gmailAlertSender(undefined, l => logs.push(l))({ type: 'DOWN', failure: 'api' });
      assert.equal(logs.length, 2);
    } finally {
      if (saved.a === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = saved.a;
      if (saved.b === undefined) delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = saved.b;
    }
  });
});
