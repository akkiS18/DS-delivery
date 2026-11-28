// Draws the "Soboy idish" icons: a round transparent plastic takeaway container with osh inside. Small (3 osh) and big (6 osh).
// Usage (from the DS repo so sharp resolves): node docs/icons/soboy-idish-icons.mjs <outDir>; copy the two PNGs to prisma/seed-assets/
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const out = process.argv[2];

/** One container centred at (256, cy), top radius rx, body height h. */
function container({ rx, h, cy, fill }) {
  const ry = rx * 0.26;           // perspective of the round rim
  const bx = rx * 0.86;           // the bottom is a little narrower (tapered tub)
  const by = bx * 0.26;
  const top = cy - h / 2 + ry * 0.4;
  const bot = top + h;
  const cx = 256;
  const body = `M ${cx - rx} ${top} L ${cx - bx} ${bot} A ${bx} ${by} 0 0 0 ${cx + bx} ${bot} L ${cx + rx} ${top} Z`;
  const level = top + h * (1 - fill);                // top surface of the osh
  const lx = rx - (rx - bx) * (1 - fill);            // radius at that height
  const lidH = rx * 0.16;
  const grains = [];
  // a few rice grains and carrot strips on the visible surface, deterministic
  let seed = Math.round(rx * 7);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const k = rx / 196; // grain size follows the container size
  const grain = (x, y, carrot, alpha) => grains.push(`<rect x="${(x - (carrot ? 10 : 5) * k).toFixed(1)}" y="${(y - 2 * k).toFixed(1)}" width="${((carrot ? 20 : 10) * k).toFixed(1)}" height="${((carrot ? 6 : 4.5) * k).toFixed(1)}" rx="${(2.5 * k).toFixed(1)}" fill="${carrot ? '#E0601C' : '#FFF6E0'}" opacity="${alpha}" transform="rotate(${Math.round(rnd() * 160 - 80)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
  // on the surface
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.9;
    grain(cx + Math.cos(a) * lx * r, level + Math.sin(a) * lx * 0.26 * r, i % 4 === 0, 1);
  }
  // seen through the plastic wall
  for (let i = 0; i < 150; i++) {
    const t = rnd(), y = level + lx * 0.2 + t * (bot - level - lx * 0.1);
    const w = rx - (rx - bx) * ((y - top) / h);
    grain(cx + (rnd() * 2 - 1) * w * 0.95, y, i % 5 === 0, 0.85);
  }
  const meat = [0.35, -0.3, 0.05].map((k, i) => {
    const x = cx + k * lx, y = level + (i - 1) * 6 + 8;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(lx * 0.12).toFixed(1)}" ry="${(lx * 0.07).toFixed(1)}" fill="#7A3E1F"/>`;
  }).join('');
  return `
  <ellipse cx="${cx}" cy="${bot + by * 0.9}" rx="${bx * 1.08}" ry="${by * 0.9}" fill="#000" opacity=".10"/>
  <clipPath id="b${rx}"><path d="${body}"/></clipPath>
  <g clip-path="url(#b${rx})">
    <rect x="0" y="${level}" width="512" height="512" fill="url(#osh)"/>
    <ellipse cx="${cx}" cy="${level}" rx="${lx}" ry="${lx * 0.26}" fill="#EDB75A"/>
    ${grains.join('')}${meat}
  </g>
  <path d="${body}" fill="url(#plastic)" stroke="#8FB9CC" stroke-width="5" stroke-linejoin="round"/>
  <path d="M ${cx - rx * 0.72} ${top + h * 0.12} L ${cx - bx * 0.70} ${bot - h * 0.10}" stroke="#fff" stroke-width="${rx * 0.09}" stroke-linecap="round" opacity=".75"/>
  <path d="M ${cx - rx * 0.50} ${top + h * 0.16} L ${cx - bx * 0.50} ${bot - h * 0.22}" stroke="#fff" stroke-width="${rx * 0.035}" stroke-linecap="round" opacity=".6"/>
  <path d="M ${cx + rx * 0.80} ${top + h * 0.14} L ${cx + bx * 0.80} ${bot - h * 0.14}" stroke="#fff" stroke-width="${rx * 0.04}" stroke-linecap="round" opacity=".45"/>
  <path d="M ${cx - rx * 1.04} ${top - lidH * 0.2} L ${cx - rx * 1.04} ${top - lidH} A ${rx * 1.04} ${ry * 1.04} 0 0 1 ${cx + rx * 1.04} ${top - lidH} L ${cx + rx * 1.04} ${top - lidH * 0.2} A ${rx * 1.04} ${ry * 1.04} 0 0 1 ${cx - rx * 1.04} ${top - lidH * 0.2} Z" fill="#D9ECF4" fill-opacity=".85" stroke="#8FB9CC" stroke-width="5" stroke-linejoin="round"/>
  <ellipse cx="${cx}" cy="${top - lidH}" rx="${rx * 1.04}" ry="${ry * 1.04}" fill="url(#lid)" stroke="#8FB9CC" stroke-width="5"/>
  <ellipse cx="${cx}" cy="${top - lidH}" rx="${rx * 0.80}" ry="${ry * 0.80}" fill="none" stroke="#A9CDDC" stroke-width="4"/>
  <ellipse cx="${cx - rx * 0.35}" cy="${top - lidH - ry * 0.35}" rx="${rx * 0.32}" ry="${ry * 0.22}" fill="#fff" opacity=".8"/>`;
}

const defs = `
  <defs>
    <linearGradient id="plastic" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#EAF5FA" stop-opacity=".55"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".18"/><stop offset="1" stop-color="#CFE6F0" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="lid" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#F4FAFD" stop-opacity=".95"/><stop offset="1" stop-color="#CBE3EE" stop-opacity=".9"/>
    </linearGradient>
    <linearGradient id="osh" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#E9AE4E"/><stop offset="1" stop-color="#D08E33"/>
    </linearGradient>
  </defs>`;

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${defs}${inner}</svg>`;
// Same canvas for both, so the small one really looks smaller next to the big one.
const files = {
  'soboy-idish-kichik': svg(container({ rx: 120, h: 118, cy: 290, fill: 0.62 })),
  'soboy-idish-katta': svg(container({ rx: 196, h: 210, cy: 280, fill: 0.66 })),
};
for (const [name, s] of Object.entries(files)) {
  writeFileSync(join(out, `${name}.svg`), s);
  await sharp(Buffer.from(s)).png({ compressionLevel: 9 }).toFile(join(out, `${name}.png`));
  await sharp(Buffer.from(s)).flatten({ background: '#ffffff' }).resize(160).jpeg({ quality: 85 }).toFile(join(out, `${name}-preview160.jpg`));
}
// side-by-side preview
const both = svg('').replace('</svg>', '');
await sharp({ create: { width: 1024, height: 512, channels: 4, background: '#ffffff' } })
  .composite([{ input: join(out, 'soboy-idish-kichik.png'), left: 0, top: 0 }, { input: join(out, 'soboy-idish-katta.png'), left: 512, top: 0 }])
  .png().toFile(join(out, 'preview-both.png'));
console.log('ok', both.length > 0);
