import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS, langFromTag, pickLang, translate } from '../src/i18n';
import { RU } from '../src/i18n/ru';
import { uzLatinToCyrillic } from '../src/i18n/translit';

const SRC = join(__dirname, '..', 'src');

/** Every text the code asks to translate: t('..'), T('..'), rich('..') with a literal first argument (an ternary passes each side through T). */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const pat = /(?<![\w.$])(?:t|T|rich)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'i18n') walk(p); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(pat)) found.set((m[1] ?? m[2]!).replace(/\\'/g, '\'').replace(/\\"/g, '"'), relative(SRC, p));
    }
  };
  walk(SRC);
  return found;
}
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort();
const tags = (s: string): string[] => [...s.matchAll(/<\/?b>/g)].map(m => m[0]).sort();

describe('language choice', () => {
  it('maps device language tags', () => {
    expect(langFromTag('ru')).toBe('ru');
    expect(langFromTag('ru-RU')).toBe('ru');
    expect(langFromTag('uz')).toBe('uz');
    expect(langFromTag('uz-UZ')).toBe('uz');
    expect(langFromTag('uz-Latn-UZ')).toBe('uz');
    expect(langFromTag('uz-Cyrl')).toBe('uz-Cyrl');
    expect(langFromTag('uz_Cyrl_UZ')).toBe('uz-Cyrl');
    expect(langFromTag('en-US')).toBeNull();
    expect(langFromTag(undefined)).toBeNull();
  });
  it('the customer\'s own choice beats the device; then the device list; then Telegram; then Uzbek', () => {
    expect(pickLang('ru', ['uz-UZ'])).toBe('ru');
    expect(pickLang('nonsense', ['ru-RU', 'uz'])).toBe('ru');
    expect(pickLang(null, ['en-US', 'uz-Cyrl-UZ'])).toBe('uz-Cyrl');
    expect(pickLang(null, ['en-US'], 'ru')).toBe('ru');
    expect(pickLang(null, ['en-US', 'de'], 'en')).toBe('uz');
    expect(pickLang(null, [])).toBe('uz');
  });
  it('offers exactly the three languages', () => {
    expect(LANGS.map(l => l.code)).toEqual(['uz', 'uz-Cyrl', 'ru']);
  });
});

describe('Uzbek Latin -> Cyrillic', () => {
  const cases: Array<[string, string]> = [
    ['Restoranlar', 'Ресторанлар'],
    ['Buyurtma', 'Буюртма'],
    ['To‘lov', 'Тўлов'],
    ['Yetkazildi', 'Етказилди'],
    ['Eshikkacha', 'Эшиккача'],
    ['Qo‘shish', 'Қўшиш'],
    ['Bog‘lash', 'Боғлаш'],
    ['yo‘l', 'йўл'],
    ['Yordam', 'Ёрдам'],
    ['Shanba', 'Шанба'],
    ['Chegirma', 'Чегирма'],
    ['Telefon raqami', 'Телефон рақами'],
    ['ma’lumot', 'маълумот'],
    ['e’tibor', 'эътибор'],
    ['Savat • {count} ta • {sum}', 'Сават • {count} та • {sum}'],
    ['Yana <b>{sum}</b> qo‘shing', 'Яна <b>{sum}</b> қўшинг'],
    ['DS Delivery', 'DS Delivery'],
    ['Telegram orqali oching', 'Telegram орқали очинг'],
    ['Telegramga bog‘lash', 'Телеграмга боғлаш'],
  ];
  it.each(cases)('%s', (latin, cyrillic) => {
    expect(uzLatinToCyrillic(latin)).toBe(cyrillic);
  });
  it('leaves digits, punctuation, placeholders and tags alone', () => {
    expect(uzLatinToCyrillic('{n} ta, 1+1 (5 000)')).toBe('{n} та, 1+1 (5 000)');
    expect(uzLatinToCyrillic('<b>{x}</b>')).toBe('<b>{x}</b>');
  });
});

describe('every text has its translations', () => {
  const keys = usedKeys();

  it('finds the texts (guards against a broken scanner)', () => {
    expect(keys.size).toBeGreaterThan(300);
  });

  it('Russian exists for every text, with the same {placeholders} and <b> tags', () => {
    const missing = [...keys].filter(([k]) => !(k in RU)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
    const broken = [...keys.keys()].filter(k => k in RU && (placeholders(k).join() !== placeholders(RU[k]!).join() || tags(k).join() !== tags(RU[k]!).join()));
    expect(broken).toEqual([]);
  });

  it('the Russian dictionary has no leftovers (entries nothing asks for)', () => {
    expect(Object.keys(RU).filter(k => !keys.has(k))).toEqual([]);
  });

  it('Russian lines are Russian (no Uzbek letters left behind)', () => {
    const uzbekish = Object.entries(RU).filter(([, v]) => /[‘’]/.test(v) || /\b(?:ta|uchun|va|bilan|yoki)\b/.test(v)).map(([k]) => k);
    expect(uzbekish).toEqual([]);
  });

  it('Cyrillic output keeps placeholders and tags, and leaves no Latin letters except brands', () => {
    const bad: string[] = [];
    for (const k of keys.keys()) {
      const c = translate('uz-Cyrl', k);
      if (placeholders(k).join() !== placeholders(c).join() || tags(k).join() !== tags(c).join()) bad.push(`placeholders: ${k}`);
      const rest = c.replace(/\{\w+\}|<\/?b>/g, '').replace(/\b(?:DS|Delivery|Telegram\w*|QR|SMS)\b/g, '');
      if (/[A-Za-z]/.test(rest)) bad.push(`latin left: ${c}`);
    }
    expect(bad).toEqual([]);
  });

  it('translate() fills placeholders and falls back to the Uzbek text', () => {
    expect(translate('uz', '{n} ta taom', { n: 3 })).toBe('3 ta taom');
    expect(translate('ru', '{n} ta taom', { n: 3 })).toBe('Блюд: 3');
    expect(translate('uz-Cyrl', '{n} ta taom', { n: 3 })).toBe('3 та таом');
    expect(translate('ru', 'bunday matn lug‘atda yo‘q')).toBe('bunday matn lug‘atda yo‘q');
    expect(translate('ru', '{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});
