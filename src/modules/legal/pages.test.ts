import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { escapeHtml, legalConfig, renderLegalPage } from './pages.js';
import { legalRoutes } from './routes.js';

const env = (o: Record<string, string> = {}): NodeJS.ProcessEnv => ({ LEGAL_OPERATOR_NAME: 'Test MChJ', LEGAL_OPERATOR_CONTACT: '+998 90 000 00 00', ...o });

describe('legal pages', () => {
  it('refuse to exist without a named operator and a contact', () => {
    assert.equal(legalConfig({}), null);
    assert.equal(legalConfig({ LEGAL_OPERATOR_NAME: 'Test MChJ' }), null);
    assert.equal(legalConfig({ LEGAL_OPERATOR_CONTACT: '+998900000000' }), null);
    assert.equal(legalConfig({ LEGAL_OPERATOR_NAME: ' ', LEGAL_OPERATOR_CONTACT: ' ' }), null);
    assert.ok(legalConfig(env()));
  });
  it('receipt retention comes from RECEIPT_RETENTION_DAYS (default 365, sane range only)', () => {
    assert.equal(legalConfig(env())!.receiptDays, 365);
    assert.equal(legalConfig(env({ RECEIPT_RETENTION_DAYS: '90' }))!.receiptDays, 90);
    assert.equal(legalConfig(env({ RECEIPT_RETENTION_DAYS: '1' }))!.receiptDays, 365);
    assert.equal(legalConfig(env({ RECEIPT_RETENTION_DAYS: 'abc' }))!.receiptDays, 365);
  });
  it('configuration values can never inject markup', () => {
    const cfg = legalConfig(env({ LEGAL_OPERATOR_NAME: '<script>alert(1)</script>"x"', LEGAL_SUPPORT_HOURS: '<img src=x onerror=alert(1)>' }))!;
    for (const kind of ['privacy', 'terms', 'delete-account'] as const) {
      const html = renderLegalPage(kind, cfg);
      assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x'), kind);
      assert.ok(html.includes('&lt;script&gt;'), kind);
    }
    assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('describe what the system really does: no card data kept, money goes to the restaurant, receipts deleted after the configured time', () => {
    const cfg = legalConfig(env({ RECEIPT_RETENTION_DAYS: '180' }))!;
    const privacy = renderLegalPage('privacy', cfg);
    assert.match(privacy, /karta ma’lumotlaringiz saqlanmaydi/);
    assert.match(privacy, /180 kundan keyin o‘chiriladi/);
    assert.match(privacy, /Test MChJ/);
    const terms = renderLegalPage('terms', cfg);
    assert.match(terms, /Platforma pulni o‘zida saqlamaydi/);
    assert.match(terms, /xizmat haqi kiritilgan/, 'the service fee inside the dish prices is disclosed');
    assert.match(terms, /yetkazilganini bildirmaydi/, 'taxi acceptance is never claimed as delivery');
  });
  it('Google Play: the privacy policy names location, device id, the deletion route; the deletion page says what is erased and what stays', () => {
    const cfg = legalConfig(env({ LEGAL_OPERATOR_CONTACT: 'owner@example.uz' }))!;
    const privacy = renderLegalPage('privacy', cfg);
    assert.match(privacy, /Joylashuv/);
    assert.match(privacy, /Profil → Hisobni o‘chirish/);
    assert.match(privacy, /\/legal\/delete-account/);
    assert.match(privacy, /owner@example\.uz/);
    assert.doesNotMatch(privacy, /sinov \(pilot\)/);
    const del = renderLegalPage('delete-account', cfg);
    assert.match(del, /Nima o‘chiriladi/);
    assert.match(del, /Nima saqlanadi/);
    assert.match(del, /owner@example\.uz/);
  });
  it('are served publicly with their own CSP, 503 until configured', async () => {
    const saved = { n: process.env.LEGAL_OPERATOR_NAME, c: process.env.LEGAL_OPERATOR_CONTACT };
    const app = Fastify();
    await app.register(legalRoutes);
    try {
      delete process.env.LEGAL_OPERATOR_NAME; delete process.env.LEGAL_OPERATOR_CONTACT;
      assert.equal((await app.inject('/legal/privacy')).statusCode, 503);
      process.env.LEGAL_OPERATOR_NAME = 'Test MChJ'; process.env.LEGAL_OPERATOR_CONTACT = '+998 90 000 00 00';
      for (const p of ['/legal/privacy', '/legal/terms', '/legal/delete-account']) {
        const res = await app.inject(p);
        assert.equal(res.statusCode, 200, p);
        assert.match(String(res.headers['content-type']), /text\/html/);
        assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
      }
      assert.equal((await app.inject('/legal/other')).statusCode, 404);
    } finally {
      if (saved.n === undefined) delete process.env.LEGAL_OPERATOR_NAME; else process.env.LEGAL_OPERATOR_NAME = saved.n;
      if (saved.c === undefined) delete process.env.LEGAL_OPERATOR_CONTACT; else process.env.LEGAL_OPERATOR_CONTACT = saved.c;
      await app.close();
    }
  });
});
