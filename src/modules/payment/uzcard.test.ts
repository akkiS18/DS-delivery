import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSom, parseSom, parseUzcardEmail, sampleUzcardEmail } from './uzcard.js';

test('kirim xabaridagi aynan summa/karta/vaqt ajratiladi, balans aralashmaydi', () => {
  const email = 'Hurmatli mijoz Sizning kartangizda quyidagi amaliyot bajarildi: Perevod na kartu: UB VISA TO UZCARD, UZ,12.10.26 23:56,karta ***8167. summa:3000.00 UZS balans:3000.00 UZS Hurmat bilan, UZCARD';
  const p = parseUzcardEmail(email);
  assert(p);
  assert.equal(p.cardLast4, '8167');
  assert.equal(p.amountTiyin, 300_000n);
  assert.equal(p.occurredAt.toISOString(), '2026-10-12T18:56:00.000Z');
});

test('chiqim va noto‘g‘ri format inkor etiladi', () => {
  assert.equal(parseUzcardEmail('Oplata uslug: karta ***8167 summa:3000.00 UZS'), null);
  assert.equal(parseUzcardEmail('Perevod na kartu: AB, UZ,31.02.26 23:56,karta ***8167. summa:3000.00 UZS'), null);
});

test('floating point ishlatilmaydi (tiyin BigInt)', () => {
  assert.equal(parseSom('21000'), 2_100_000n);
  assert.equal(formatSom(2_100_050n), '21,000.50 so‘m');
  assert.equal(parseUzcardEmail(sampleUzcardEmail('8167', 2_100_050n))?.amountTiyin, 2_100_050n);
});
