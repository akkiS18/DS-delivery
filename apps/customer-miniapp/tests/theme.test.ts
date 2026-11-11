import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHROME, parsePref, resolveTheme } from '../src/lib/theme';

const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const block = (selector: string): string => {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector}`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
};
const tokens = (body: string): string[] => [...body.matchAll(/^\s*(--[\w-]+):/gm)].map(m => m[1]!);

describe('theme choice', () => {
  it('follows Telegram inside the Mini App, even against the phone setting', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
  it('follows the phone when Telegram says nothing (browser, APK, old client)', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
    expect(resolveTheme('weird', true)).toBe('dark');
  });
  it('has chrome colours for both themes', () => {
    expect(CHROME.dark.background).not.toBe(CHROME.light.background);
  });
});

describe('dark palette in styles.css', () => {
  const light = tokens(block(':root {'));
  const dark = tokens(block(":root[data-theme='dark']"));

  it('only overrides tokens that exist in the light theme', () => {
    expect(dark.filter(t => t !== undefined && !light.includes(t))).toEqual([]);
  });
  it('re-colours the surface, text and line tokens', () => {
    for (const t of ['--bg', '--card', '--ink', '--ink-soft', '--line', '--mint', '--mint-soft', '--primary-text', '--primary-fg', '--dark-surface']) expect(dark).toContain(t);
  });
  it('keeps no white page surface or green text colour that would not flip', () => {
    const rules = css.split('\n').filter(l => !l.startsWith('  --'));
    const surfaces = rules.filter(l => /background(-color)?:\s*#fff\b/.test(l) && !l.startsWith('.logo-round') && !l.startsWith('.switch::after')); // logos and the switch knob stay white
    expect(surfaces).toEqual([]);
    const greenText = rules.filter(l => /(?<![-\w])color:\s*var\(--primary(-dark)?\)/.test(l));
    expect(greenText).toEqual([]);
  });
});

describe('styles.css is well formed after token changes', () => {
  it('has no leftover replacement placeholders ($1, $&)', () => {
    expect(css.split('\n').filter(l => /\$[1-9&]/.test(l))).toEqual([]);
  });
  it('has no declaration that lost its property name', () => {
    expect(css.split('\n').filter(l => /[{;]\s*var\(--/.test(l))).toEqual([]);
  });
  it('defines every colour token it uses (runtime-set sizes aside)', () => {
    const defined = new Set(tokens(block(':root {')));
    const used = [...css.matchAll(/var\((--[\w-]+)\s*[,)]/g)].map(m => m[1]!);
    const runtime = new Set(['--tg-safe-area-inset-bottom', '--cartbar-h', '--kb-h', '--vh', '--kb-offset']);
    expect([...new Set(used)].filter(u => !defined.has(u) && !runtime.has(u))).toEqual([]);
  });
});

describe('font', () => {
  it('uses Onest from the bundled package, with the system font as fallback', () => {
    expect(css).toMatch(/font-family: 'Onest Variable', system-ui/);
    expect(readFileSync(join(__dirname, '..', 'src', 'main.tsx'), 'utf8')).toContain("@fontsource-variable/onest");
    expect(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).toContain('"@fontsource-variable/onest": "5.3.1"');
  });
});

describe('manual theme choice', () => {
  it('an explicit choice beats Telegram and the phone', () => {
    expect(resolveTheme('light', true, 'dark')).toBe('dark');
    expect(resolveTheme('dark', false, 'light')).toBe('light');
    expect(resolveTheme('dark', false, 'auto')).toBe('dark');
  });
  it('reads only known values from storage', () => {
    expect(parsePref('dark')).toBe('dark');
    expect(parsePref('light')).toBe('light');
    expect(parsePref('x')).toBe('auto');
    expect(parsePref(null)).toBe('auto');
  });
});

describe('dark theme keeps the tab bar and green headers readable', () => {
  it('draws the idle tab labels in a fixed light colour (the mint-soft token turns dark)', () => {
    expect(css).toMatch(/\.tabbar button \{[^}]*color: var\(--on-dark\);/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \.tabbar button\.on \{ background: var\(--primary\); color: #fff; \}/);
  });
  it('defines the on-dark tokens once and does not override them in the dark theme', () => {
    expect(tokens(block(':root {'))).toEqual(expect.arrayContaining(['--on-dark', '--on-dark-mint']));
    expect(tokens(block(":root[data-theme='dark']"))).not.toContain('--on-dark');
  });
});

describe('restaurant pictures', () => {
  it('fill their frame: no blurred copy behind, no contain-fit', () => {
    expect(css).not.toMatch(/rphoto-bg|rphoto-whole/);
    expect(css).not.toMatch(/\.logo-round \.rphoto-img \{ object-fit: contain/);
    expect(readFileSync(join(__dirname, '..', 'src', 'components', 'RestaurantPhoto.tsx'), 'utf8')).not.toMatch(/rphoto-bg|blur\(|whole\s*[=?:]/);
  });
});

describe('APK status bar', () => {
  it('is painted with the header green so its light icons stay readable on every screen', () => {
    expect(css).toMatch(/:root\[data-app='android'\] body::before \{[^}]*height: env\(safe-area-inset-top[^}]*background: var\(--primary-dark\)/);
  });
});
