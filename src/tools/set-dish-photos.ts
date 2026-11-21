import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, basename, resolve } from 'node:path';
import sharp from 'sharp';
import { db } from '../lib/db.js';
import { setProductImage } from '../modules/restaurant-catalog/images.js';
import { matchDishes } from './dish-photo-match.js';

/**
 * Owner request 2026-11-20: dish pictures from a folder, matched by FILE NAME, for any restaurant. Reusable: the owner makes pictures one by one
 * (Muslima kafe: Gemini pictures in DS-backups/muslima-photos), we copy the new files to the server and run this again; no release needed.
 *
 *   node dist/src/tools/set-dish-photos.js --restaurant muslima --dir /tmp/muslima-photos            (plan, writes nothing)
 *   node dist/src/tools/set-dish-photos.js --restaurant muslima --dir /tmp/muslima-photos --apply
 *
 * Matching: the file name without extension, against the dish name written the same way (lower case, apostrophes dropped, other signs -> "-").
 * First an exact match of the whole name ("osh-1-kg.webp" -> "Osh (1 kg)"); if none, the name without its bracket part, so
 * "gilak-shorva.webp" sets BOTH "G‘ilak sho‘rva (1 porsiya)" and "G‘ilak sho‘rva (0,7 porsiya)". A file that matches nothing is reported.
 * Replacing: a dish with no picture, or whose picture was set by one of our tools (actor "owner-..."), gets the new one. A picture the restaurant
 * set itself in its app is kept unless --force. The same picture twice is skipped (same sha256), so a second run changes nothing.
 * Big files are shrunk to 1280 px (WebP q82); the app makes the small copies itself.
 */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const arg = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const SLUG = arg('--restaurant');
const DIR = arg('--dir');
const ACTOR = `owner-dish-photos-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const EXT = new Set(['.webp', '.jpg', '.jpeg', '.png']);
const MAX_SIDE = 1280;
const MAX_BYTES = 900 * 1024;
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

async function prepare(file: string): Promise<Buffer> {
  const raw = readFileSync(file);
  const meta = await sharp(raw).metadata();
  if (raw.length <= MAX_BYTES && Math.max(meta.width ?? 0, meta.height ?? 0) <= MAX_SIDE * 1.25) return raw;
  return sharp(raw).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

async function main(): Promise<void> {
  if (!SLUG || !DIR) throw new Error('usage: --restaurant <slug> --dir <folder> [--apply] [--force]');
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!r) throw new Error(`restaurant ${SLUG} not found`);
  const dishes = await db.product.findMany({ where: { restaurantId: r.id, archivedAt: null }, select: { id: true, name: true, imageUrl: true, image: { select: { sha256: true, version: true } } } });
  const files = readdirSync(DIR).filter(f => EXT.has(extname(f).toLowerCase())).sort();
  log(`${r.name} (${SLUG}): ${dishes.length} dishes, ${files.length} picture files in ${DIR}`);
  const claimed = new Map<string, string>();
  let set = 0; let kept = 0; let same = 0; const unmatched: string[] = [];
  for (const f of files) {
    const hits = matchDishes(basename(f, extname(f)), dishes);
    if (!hits.length) { unmatched.push(f); continue; }
    const bytes = await prepare(resolve(DIR, f));
    const sha = createHash('sha256').update(bytes).digest('hex');
    for (const d of hits) {
      const other = claimed.get(d.id);
      if (other) throw new Error(`"${d.name}" is matched by two files: ${other} and ${f}`);
      claimed.set(d.id, f);
      if (d.image?.sha256 === sha) { same++; log(`${d.name}: already this picture`); continue; }
      if (d.image || d.imageUrl) {
        const last = await db.catalogEvent.findFirst({ where: { entity: 'PRODUCT', entityId: d.id, action: 'PRODUCT_IMAGE_SET' }, orderBy: { createdAt: 'desc' }, select: { actorSessionId: true } });
        const ours = !!last?.actorSessionId?.startsWith('owner-');
        if (!ours && !FORCE) { kept++; log(`${d.name}: the restaurant set its own picture, kept (use --force to replace)`); continue; }
      }
      set++;
      log(`${d.name}: ${d.image ? 'replace' : 'new'} picture = ${f} (${Math.round(bytes.length / 1024)} KB)`);
      if (APPLY) await setProductImage(r.id, ACTOR, d.id, bytes);
    }
  }
  const noPhoto = dishes.filter(d => !claimed.has(d.id) && !d.image && !d.imageUrl).map(d => d.name);
  log(`${set} pictures ${APPLY ? 'set' : 'to set'}, ${same} unchanged, ${kept} kept (restaurant's own)`);
  if (unmatched.length) log(`files that match no dish: ${unmatched.join(', ')}`);
  log(`${noPhoto.length} dishes still without a picture: ${noPhoto.join(', ')}`);
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
}

try { await main(); } catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
