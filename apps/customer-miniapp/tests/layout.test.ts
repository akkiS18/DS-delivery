import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', 'src');
const css = readFileSync(join(src, 'styles.css'), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('global layout', () => {
  it('reserves room for the fixed tab bar plus safe area in one place', () => {
    expect(css).toMatch(/--nav-space:\s*calc\(var\(--tabbar\)\s*\+\s*var\(--safe-bottom\)\)/);
    expect(css).toMatch(/\.app-main\s*\{[^}]*padding-bottom:\s*calc\(var\(--nav-space\)/);
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
    expect(css).toMatch(/100dvh/);
  });
  it('pins the basket button above the tab bar and gives the page room for it; hides it with the keyboard', () => {
    expect(css).toMatch(/\.cartfloat\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(var\(--nav-space\)/);
    expect(css).toMatch(/\.app-main\s*\{[^}]*padding-bottom:\s*calc\(var\(--nav-space\)[^}]*var\(--cartbar-h/);
    expect(css).toMatch(/:root\[data-kb='open'\]\s*\.cartfloat\s*\{\s*display:\s*none/);
  });
  it('wraps every screen in the shared shell', () => {
    const app = readFileSync(join(src, 'App.tsx'), 'utf8');
    expect(app).toMatch(/className={?["`]app-main/);
  });
});

describe('icons', () => {
  it('uses no emoji in the UI source', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}✓✕]/u;
    for (const f of walk(src).filter(f => /\.tsx$/.test(f))) expect(readFileSync(f, 'utf8'), f).not.toMatch(emoji);
  });
  it('removed the home intro card', () => {
    expect(readFileSync(join(src, 'screens', 'Home.tsx'), 'utf8')).not.toContain('hero');
  });
});
