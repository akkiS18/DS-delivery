// Wide (2:1) restaurant picture drawn from icons, in the brand's colours, WITHOUT the logo (owner request 2026-11-22:
// "logoni 2:1 rasmda ishlatma, alohida ikonkalar ko'rinishida qil"). Icons are lucide (ISC licence), the same set the customer app uses.
//   node scripts/make-icon-banner.mjs <preset> <out.webp> [--preview dir]      presets: asl-market, tengsiz-food
// --preview writes the crops the app shows: home card (~2.1:1), menu header (~1.6:1, under the dark 66 % layer), square.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/customer-miniapp/package.json'));
const sharp = require('sharp');
const ICONS = join(process.cwd(), 'apps/customer-miniapp/node_modules/lucide-react/dist/esm/icons');

const W = 1600, H = 800;

const PRESETS = {
  // Asl Market: shop goods, red neon on near-black (the colours of its sign).
  'asl-market': {
    bg: ['#2a0707', '#0a0202'],
    colors: ['#ff3b30', '#ff6a3d', '#ffd1c4'],
    glow: '#ff2a1f',
    icons: ['shopping-cart', 'milk', 'apple', 'candy', 'cookie', 'cup-soda', 'croissant', 'egg', 'carrot', 'banana', 'cherry',
      'shopping-basket', 'lollipop', 'coffee', 'grape', 'wheat', 'citrus', 'cake-slice', 'ice-cream-cone', 'fish'],
  },
  // Tengsiz food: fast food, white and red on its yellow-orange.
  'tengsiz-food': {
    bg: ['#ffc12e', '#f59e0b'],
    colors: ['#ffffff', '#e3141b', '#7a2e00'],
    glow: null,
    icons: ['pizza', 'sandwich', 'beef', 'drumstick', 'cup-soda', 'popcorn', 'flame', 'utensils-crossed', 'chef-hat', 'salad',
      'soup', 'coffee', 'ice-cream-cone', 'cake-slice'],
  },
};

function iconSvgBody(name) {
  const src = readFileSync(join(ICONS, `${name}.js`), 'utf8');
  const list = src.slice(src.indexOf('[', src.indexOf('createLucideIcon(')), src.lastIndexOf(']') + 1);
  const nodes = Function(`return ${list}`)();
  return nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}

// Small deterministic random, so the same preset always gives the same picture.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function bannerSvg(p) {
  const rand = rng(20261122);
  const cell = 150, size = 78;
  const parts = [];
  let prev = '';
  for (let row = -1; row * cell * 0.86 < H + cell; row++) {
    const y = row * cell * 0.86;
    const shift = row % 2 ? cell / 2 : 0;
    for (let x = -cell + shift; x < W + cell; x += cell) {
      let name = prev;
      while (name === prev) name = p.icons[Math.floor(rand() * p.icons.length)]; // random, never twice in a row: no diagonal stripes
      prev = name;
      const color = p.colors[Math.floor(rand() * p.colors.length)];
      const rot = Math.round((rand() - 0.5) * 30);
      const op = (0.55 + rand() * 0.45).toFixed(2);
      const jx = (rand() - 0.5) * 24, jy = (rand() - 0.5) * 24;
      parts.push(`<g transform="translate(${(x + jx).toFixed(1)} ${(y + jy).toFixed(1)}) rotate(${rot} ${size / 2} ${size / 2}) scale(${size / 24})" `
        + `fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${op}">${iconSvgBody(name)}</g>`);
    }
  }
  const glow = p.glow ? `<filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></radialGradient>${glow}</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g ${p.glow ? 'filter="url(#g)"' : ''}>${parts.join('')}</g>
</svg>`;
}

const [preset, out, ...rest] = process.argv.slice(2);
const p = PRESETS[preset];
if (!p || !out) { console.error(`usage: node scripts/make-icon-banner.mjs <${Object.keys(PRESETS).join('|')}> <out.webp> [--preview dir]`); process.exit(1); }
const png = await sharp(Buffer.from(bannerSvg(p))).png().toBuffer();
const info = await sharp(png).webp({ quality: 82 }).toFile(out);
console.log(`${out}: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB`);

const pi = rest.indexOf('--preview');
if (pi >= 0) {
  const dir = rest[pi + 1]; mkdirSync(dir, { recursive: true });
  const crop = (ratio) => { const w = Math.min(W, Math.round(H * ratio)); const h = Math.min(H, Math.round(w / ratio)); return { left: (W - w) >> 1, top: (H - h) >> 1, width: w, height: h }; };
  await sharp(png).extract(crop(360 / 170)).resize(720, 340).toFile(join(dir, 'card.png'));
  await sharp(png).extract(crop(390 / 250)).resize(780, 500)
    .composite([{ input: Buffer.from(`<svg width="780" height="500"><rect width="780" height="500" fill="rgb(27,48,49)" fill-opacity="0.66"/></svg>`) }]).toFile(join(dir, 'menu-header.png'));
}
