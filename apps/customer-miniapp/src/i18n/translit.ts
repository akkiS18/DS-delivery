/**
 * Uzbek Latin -> Uzbek Cyrillic, by rule. The app's source text is Uzbek Latin, so the Cyrillic version is generated instead of being typed twice
 * (one source of truth; a text fixed in Latin is fixed in Cyrillic too). A native reader should still review the result once; individual words can be
 * overridden in UZ_CYRL_OVERRIDES (dictionary.ts).
 *
 * Rules (the current official Cyrillic spelling):
 *  sh ch yo yu ya ye -> ш ч ё ю я е;  o‘ g‘ -> ў ғ;  q h x j y -> қ ҳ х ж й;  initial e -> э;  tutuq after a vowel (e’tibor) -> ъ.
 * Untouched: digits, punctuation, {placeholders}, <b> tags and brand/acronym words (PROTECTED).
 */
const PROTECTED = new Set(['ds', 'qr', 'sms', 'pin', 'apk', 'usb', 'humo', 'uzcard', 'visa', 'mastercard', 'telegram', 'delivery', 'click', 'payme', 'id', 'wifi']);

const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
};
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
/** U+2018/U+02BB mark o‘/g‘ (and a tutuq elsewhere); U+2019/U+02BC and ASCII ' likewise. */
const TURN = new Set(['‘', 'ʻ', '’', 'ʼ', '\'', '`']);
const STRONG_TUTUQ = new Set(['’', 'ʼ']); // always a tutuq (ъ), even after o/g

/** Case of the source letters carried over to the converted text. */
function cased(src: string, out: string): string {
  const first = src[0]!;
  if (first === first.toLowerCase()) return out;
  const second = src.length > 1 ? src[1]! : '';
  return second && second !== second.toLowerCase() ? out.toUpperCase() : out.charAt(0).toUpperCase() + out.slice(1);
}

function convertWord(w: string): string {
  if (PROTECTED.has(w.toLowerCase())) return w;
  let out = '';
  let i = 0;
  while (i < w.length) {
    const ch = w[i]!;
    const lo = ch.toLowerCase();
    const next = w[i + 1];
    const nextLo = next?.toLowerCase();
    const afterNext = w[i + 2];
    const turnAfter = (j: number): boolean => w[j] !== undefined && TURN.has(w[j]!) && !STRONG_TUTUQ.has(w[j]!);
    // o‘ / g‘
    if ((lo === 'o' || lo === 'g') && next !== undefined && TURN.has(next) && !STRONG_TUTUQ.has(next)) {
      out += cased(ch, lo === 'o' ? 'ў' : 'ғ'); i += 2; continue;
    }
    // tutuq
    if (TURN.has(ch)) { out += i > 0 && VOWELS.has(w[i - 1]!.toLowerCase()) ? 'ъ' : ''; i += 1; continue; }
    if (lo === 's' && nextLo === 'h') { out += cased(w.slice(i, i + 2), 'ш'); i += 2; continue; }
    if (lo === 'c' && nextLo === 'h') { out += cased(w.slice(i, i + 2), 'ч'); i += 2; continue; }
    if (lo === 'y' && nextLo !== undefined && 'ouae'.includes(nextLo)) {
      // yo‘l = й + ў, not ё + tutuq
      if (nextLo === 'o' && afterNext !== undefined && turnAfter(i + 2)) { out += cased(ch, 'й'); i += 1; continue; }
      const map: Record<string, string> = { o: 'ё', u: 'ю', a: 'я', e: 'е' };
      out += cased(w.slice(i, i + 2), map[nextLo]!); i += 2; continue;
    }
    if (lo === 'e' && i === 0) { out += cased(ch, 'э'); i += 1; continue; }
    const m = SINGLE[lo];
    out += m !== undefined ? cased(ch, m) : ch;
    i += 1;
  }
  return out;
}

const TOKEN = /\{[^}]*\}|<\/?[a-z]+>|[A-Za-z]+(?:[‘ʻ’ʼ'`][A-Za-z]+)*/g;

export function uzLatinToCyrillic(text: string): string {
  return text.replace(TOKEN, tok => (tok.startsWith('{') || tok.startsWith('<') ? tok : convertWord(tok)));
}
