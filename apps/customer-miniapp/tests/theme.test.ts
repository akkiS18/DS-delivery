import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHROME, resolveTheme } from '../src/lib/theme';

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
    const surfaces = rules.filter(l => /background(-color)?:\s*#fff\b/.test(l) && !l.startsWith('.logo-round'));
    expect(surfaces).toEqual([]);
    const greenText = rules.filter(l => /(?<![-\w])color:\s*var\(--primary(-dark)?\)/.test(l));
    expect(greenText).toEqual([]);
  });
});
