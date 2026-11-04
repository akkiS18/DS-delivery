import assert from 'node:assert/strict';
import { humoMessageKey, humoSlots, ingestHumoMessage, isUnreadableHumoCredit, type TgMessage } from './humo-telegram.js';
import type { PaymentEngineV3 } from './engine.js';
import test from 'node:test';
import { isKnownHumoTitle, looksLikeHumoCredit, parseHumoMessage, sampleHumoMessage } from './humo.js';

const OBSERVED = `🎉 To'ldirish
➕ 5.000,00 UZS
📍 PAYME P2P UZCARD NA
💳 HUMOCARD *6062
🕓 15:39 27.10.2026
💰 5.000,00 UZS`;

test('the observed message parses: amount from the plus line, card, Tashkent time', () => {
  const p = parseHumoMessage(OBSERVED)!;
  assert.equal(p.cardLast4, '6062');
  assert.equal(p.amountTiyin, 500_000n);
  assert.equal(p.occurredAt.toISOString(), '2026-10-27T10:39:00.000Z');
  assert.equal(p.operation, 'PAYME P2P UZCARD NA');
  assert.equal(p.minutePrecision, true);
});

test('the balance line is never taken for the amount', () => {
  const p = parseHumoMessage(sampleHumoMessage('6062', 2_100_000n, new Date('2026-10-27T10:39:00Z'), 98_765_400n))!;
  assert.equal(p.amountTiyin, 2_100_000n);
});

test('thousands, decimals and spaces', () => {
  const amount = (s: string) => parseHumoMessage(OBSERVED.replace('5.000,00', s))?.amountTiyin;
  assert.equal(amount('21.000,00'), 2_100_000n);
  assert.equal(amount('1.234.567,50'), 123_456_750n);
  assert.equal(amount('150,5'), 15_050n);
  assert.equal(amount('300'), 30_000n);
  assert.equal(amount('21 000,00'), 2_100_000n);
});

test('anything that is not an unambiguous credit is refused', () => {
  const swap = (a: string, b: string) => parseHumoMessage(OBSERVED.replace(a, b));
  assert.equal(swap('➕', '➖'), null, 'a debit');
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ 5.000,00 UZS', '➕ 5.000,00 UZS\n➖ 1.000,00 UZS')), null, 'mixed');
  assert.equal(swap('5.000,00 UZS\n📍', '0,00 UZS\n📍'), null, 'zero');
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5,000.00 UZS'), null, 'other number style is not guessed');
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5.00 UZS'), null);
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5.000,00 USD'), null, 'other currency');
  assert.equal(swap('*6062', '*60'), null, 'card digits');
  assert.equal(swap('15:39 27.10.2026', '25:39 27.10.2026'), null, 'impossible hour');
  assert.equal(swap('15:39 27.10.2026', '15:39 31.02.2026'), null, 'impossible date');
  assert.equal(swap('🕓', '⏰'), null, 'no time');
  assert.equal(parseHumoMessage('Salom! Bu oddiy xabar'), null);
  assert.equal(parseHumoMessage(''), null);
});

test('sampleHumoMessage round-trips', () => {
  const at = new Date('2026-01-02T03:04:00Z');
  const p = parseHumoMessage(sampleHumoMessage('1234', 12_345_600n, at))!;
  assert.equal(p.cardLast4, '1234');
  assert.equal(p.amountTiyin, 12_345_600n);
  assert.equal(p.occurredAt.getTime(), at.getTime());
});

test('the sign decides, not the heading: other headings with a plus are credits, with a minus are not', () => {
  for (const title of ['Karta hisobi o\'zgardi', 'Amaliyot', 'Kirim']) {
    const p = parseHumoMessage(OBSERVED.replace('🎉 To\'ldirish', `🎉 ${title}`))!;
    assert.equal(p.amountTiyin, 500_000n, title);
    assert.equal(p.title.startsWith(title.slice(0, 5)), true, title);
    assert.equal(isKnownHumoTitle(p.title), false, title);
    assert.equal(parseHumoMessage(OBSERVED.replace('🎉 To\'ldirish', `🎉 ${title}`).replace('➕', '➖')), null, `${title} debit`);
  }
  assert.equal(isKnownHumoTitle(parseHumoMessage(OBSERVED)!.title), true);
});

test('a plain + / - sign works like the emoji; a minus stays a debit', () => {
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ ', '+'))!.amountTiyin, 500_000n);
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ ', '+ '))!.amountTiyin, 500_000n);
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ ', '-')), null);
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ ', '−')), null);
});

test('looksLikeHumoCredit flags a plus message that cannot be read, not a plain notice', () => {
  assert.equal(looksLikeHumoCredit('Amaliyot\n+ 5.000,00 so‘m\nkarta *6062'), true);
  assert.equal(parseHumoMessage('Amaliyot\n+ 5.000,00 so‘m\nkarta *6062'), null);
  assert.equal(looksLikeHumoCredit('➖ 5.000,00 UZS'), false);
  assert.equal(looksLikeHumoCredit('Salom! Yangi aksiya: 10% chegirma'), false);
});

test('an unreadable credit is reported only for the verified bot, fresh, and never for readable or foreign messages', () => {
  const now = Date.now();
  const msg = (over: Partial<TgMessage> = {}): TgMessage => ({ id: 1, date: Math.floor(now / 1000), message: 'Amaliyot\n+ 5.000,00 so‘m', senderId: { toString: () => 'BOT' }, ...over });
  assert.equal(isUnreadableHumoCredit('BOT', msg(), now, 1_800_000), true);
  assert.equal(isUnreadableHumoCredit('BOT', msg({ senderId: { toString: () => '777' } }), now, 1_800_000), false, 'not the bot');
  assert.equal(isUnreadableHumoCredit('BOT', msg({ out: true }), now, 1_800_000), false);
  assert.equal(isUnreadableHumoCredit('BOT', msg({ date: Math.floor(now / 1000) - 7200 }), now, 1_800_000), false, 'old');
  assert.equal(isUnreadableHumoCredit('BOT', msg({ message: OBSERVED }), now, 1_800_000), false, 'readable');
});

test('several Telegram accounts: message ids only count per account, so the stored key carries the account; the first account keeps the old key', async () => {
  assert.equal(humoMessageKey('BOT', '', 7), 'BOT:7');
  assert.equal(humoMessageKey('BOT', '2', 7), 'BOT:2:7');
  assert.notEqual(humoMessageKey('BOT', '2', 7), humoMessageKey('BOT', '3', 7));
  assert.deepEqual(humoSlots({}), ['']);
  assert.deepEqual(humoSlots({ HUMO_TG_API_ID_2: '123', HUMO_TG_API_ID_4: ' 9 ', HUMO_TG_API_ID_3: '  ' }), ['', '2', '4']);

  const keys: string[] = [];
  const engine = { isRegisteredCard: async () => true, ingestHumo: async (key: string) => { keys.push(key); return { status: 'MATCHED_UNVERIFIED' }; } } as unknown as PaymentEngineV3;
  const now = Date.now();
  const text = sampleHumoMessage('6062', 5_000_00n, new Date(now - 60_000));
  const msg: TgMessage = { id: 41, date: Math.floor(now / 1000), message: text, senderId: { toString: () => 'BOT' } };
  await ingestHumoMessage(engine, 'BOT', msg, now, 1_800_000);
  await ingestHumoMessage(engine, 'BOT', msg, now, 1_800_000, '2');
  assert.deepEqual(keys, ['BOT:41', 'BOT:2:41']);
});

test('money on a card that is not registered in the system (a partner\'s own card in the same chat) is ignored: the engine is never called', async () => {
  const keys: string[] = [];
  const engine = { isRegisteredCard: async (last4: string) => last4 === '6062', ingestHumo: async (key: string) => { keys.push(key); return { status: 'MATCHED_UNVERIFIED' }; } } as unknown as PaymentEngineV3;
  const now = Date.now();
  const msgFor = (id: number, card: string): TgMessage => ({ id, date: Math.floor(now / 1000), message: sampleHumoMessage(card, 45_000_00n, new Date(now - 60_000)), senderId: { toString: () => 'BOT' } });
  assert.equal(await ingestHumoMessage(engine, 'BOT', msgFor(1, '7286'), now, 1_800_000), null);
  assert.deepEqual(keys, []);
  assert.ok(await ingestHumoMessage(engine, 'BOT', msgFor(2, '6062'), now, 1_800_000));
  assert.deepEqual(keys, ['BOT:2']);
});
