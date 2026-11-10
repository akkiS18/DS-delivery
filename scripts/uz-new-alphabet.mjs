#!/usr/bin/env node
// Uzbek Latin alphabet, new orthography (law O'RQ-1184, signed 2026-10-21, in force from 2027-04-22):
//   Oʻ oʻ -> Ö ö     Gʻ gʻ -> Ğ ğ     Sh sh -> Ş ş     Ch ch -> Ç ç      ("ng" and the tutuq sign ʼ stay: tong, maʼno)
// Finds (and with --write fixes) user-visible Uzbek text in string literals of Kotlin files and in <string> values of Android XML.
//   node scripts/uz-new-alphabet.mjs <dir> [--write] [--words]
// Without --write it only reports and exits 1 when something is still in the old spelling (usable as a check).
// What it does NOT touch: comments, identifiers, codes (OPEN_DISPATCHES), keys (cashAllowed, pin_hash), paths and URLs, and anything inside ${...} or $name.
// The old signs are U+2018 and U+02BB after o/g (this code base writes oʻ and gʻ with U+2018). The tutuq sign stays U+2019 because Manrope has no U+02BC.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const root = args.find(a => !a.startsWith('--'));
const WRITE = args.includes('--write');
const WORDS = args.includes('--words');
const TS = args.includes('--ts'); // also TypeScript files: '...', "..." and `...` literals (use it on one server file at a time and read the diff)
if (!root) { console.error('usage: node scripts/uz-new-alphabet.mjs <dir> [--write] [--words]'); process.exit(2); }

// Single-token literals that are code, not Uzbek text.
const CODE_WORDS = new Set(['cash', 'reachable', 'dishes']);

const OLD_O = /([oO])[‘ʻ]/g;
const OLD_G = /([gG])[‘ʻ]/g;
const DIGRAPH = /(Sh|SH|sh|Ch|CH|ch)/g;

export function convertText(s) {
  return s
    .replace(OLD_O, (_, c) => (c === 'o' ? 'ö' : 'Ö'))
    .replace(OLD_G, (_, c) => (c === 'g' ? 'ğ' : 'Ğ'))
    .replace(DIGRAPH, m => (m[0] === 's' ? 'ş' : m[0] === 'S' ? 'Ş' : m[0] === 'c' ? 'ç' : 'Ç'));
}

/** Converts a literal body but leaves ${...} and $name alone. */
export function convertLiteral(body) {
  if (body.includes('://')) return body;
  // A one-word label that still has an old sign ("Yo‘q.") is text, never a key: codes and keys do not contain U+2018.
  if (!/\s/.test(body) && !/[oOgG][‘ʻ]/.test(body)) { // a single token: code or a one-word label
    if (/^[A-Z0-9_]+$/.test(body)) return body;          // OPEN_DISPATCHES
    if (/[._/:@#\\]/.test(body.replace(/…$/, ''))) return body; // keys, paths, ids
    if (/[a-z][A-Z]/.test(body)) return body;             // camelCase
    if (CODE_WORDS.has(body)) return body;
  }
  let out = '', plain = '', i = 0;
  const flush = () => { out += convertText(plain); plain = ''; };
  while (i < body.length) {
    if (body[i] === '$' && body[i + 1] === '{') {
      flush();
      let depth = 0, j = i + 1;
      for (; j < body.length; j++) { if (body[j] === '{') depth++; else if (body[j] === '}' && --depth === 0) break; }
      out += body.slice(i, j + 1); i = j + 1; continue;
    }
    if (body[i] === '$' && /[A-Za-z_]/.test(body[i + 1] ?? '')) {
      flush();
      let j = i + 1; while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++;
      out += body.slice(i, j); i = j; continue;
    }
    plain += body[i++];
  }
  flush();
  return out;
}

function walk(d) { if (statSync(d).isFile()) return [d]; return readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (/(^|[\\/])(build|\.gradle)$/.test(p) ? [] : walk(p)) : [p]; }); }

const changed = new Map(); // old word -> new word
let files = 0, literals = 0;
for (const file of walk(root)) {
  const isTs = TS && /\.tsx?$/.test(file);
  const isKt = file.endsWith('.kt') || isTs, isXml = /[\\/]res[\\/]values[\\/]strings\.xml$/.test(file);
  if (!isKt && !isXml) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  let fileChanged = false;
  const next = lines.map((line, n) => {
    let fixed = line;
    if (isKt) {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return line;
      const literal = isTs ? /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g : /"(?:[^"\\]|\\.)*"/g;
      fixed = line.replace(literal, lit => {
        const q = lit[0], body = lit.slice(1, -1), nb = convertLiteral(body);
        if (nb !== body) record(file, n, body, nb);
        return nb === body ? lit : q + nb + q;
      });
    } else {
      fixed = line.replace(/(<string\b[^>]*>)([^<]*)(<\/string>)/g, (m, a, body, c) => {
        const nb = convertLiteral(body);
        if (nb !== body) record(file, n, body, nb);
        return nb === body ? m : a + nb + c;
      });
    }
    if (fixed !== line) fileChanged = true;
    return fixed;
  });
  function record(f, n, a, b) {
    literals++;
    const wa = a.split(/[\s"«»„“()+,.:;!?/…—–·•-]+/), wb = b.split(/[\s"«»„“()+,.:;!?/…—–·•-]+/);
    wa.forEach((w, k) => { if (wb[k] !== undefined && wb[k] !== w) changed.set(w, wb[k]); });
  }
  if (fileChanged) { files++; if (WRITE) writeFileSync(file, next.join('\n')); else console.log('old spelling: ' + relative(root, file)); }
}
if (WORDS) console.log([...changed].map(([a, b]) => `${a} -> ${b}`).sort().join('\n'));
console.log(`${WRITE ? 'rewrote' : 'would change'} ${literals} literals in ${files} files`);
process.exit(!WRITE && literals > 0 ? 1 : 0);
