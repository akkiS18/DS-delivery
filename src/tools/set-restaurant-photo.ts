import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../lib/db.js';

/**
 * The restaurant photo / logo (home card, menu header, search row) from a WebP file, for any restaurant. Started for Asl Market 2026-11-22.
 *   node set-restaurant-photo.js --restaurant asl-market --file /tmp/x/logo.webp [--replace] [--apply]
 * Plan unless --apply. A photo the restaurant already has is kept unless --replace; the same picture again is skipped (same sha256).
 * Shrink the picture beforehand (about 1024 px, WebP); the app makes the small copies itself.
 * No release needed: streamed into the prod container's /tmp like scripts/upload-dish-photos.sh (db import rewritten to /app/dist).
 */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPLACE = args.includes('--replace');
const arg = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const SLUG = arg('--restaurant');
const FILE = arg('--file');
const ACTOR = `owner-restaurant-photo-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

async function main(): Promise<void> {
  if (!SLUG || !FILE) throw new Error('usage: --restaurant <slug> --file <picture.webp> [--replace] [--apply]');
  const bytes = readFileSync(FILE);
  const isWebp = bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isWebp || bytes.length < 1024 || bytes.length > 1024 * 1024) throw new Error(`not a WebP picture of 1 KB - 1 MB: ${FILE}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, image: { select: { version: true, sha256: true } } } });
  if (!r) { log(`no restaurant with slug "${SLUG}": nothing written`); return; }
  if (r.image?.sha256 === sha256) { log(`${r.name}: already shows this picture (v${r.image.version})`); return; }
  if (r.image && !REPLACE) { log(`${r.name}: already has a photo (v${r.image.version}), kept (use --replace to change it)`); return; }
  const version = (r.image?.version ?? 0) + 1;
  log(`${r.name} (${SLUG}): photo = ${FILE} (${Math.round(bytes.length / 1024)} KB), version ${version}`);
  if (!APPLY) { console.log('Nothing written. Add --apply to write.'); return; }
  const img = { mime: 'image/webp', data: Uint8Array.from(bytes), sha256 };
  await db.restaurantImage.upsert({ where: { restaurantId: r.id }, create: { restaurantId: r.id, ...img, version }, update: { ...img, version } });
  await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'RESTAURANT_IMAGE_SET', targetType: 'Restaurant', targetId: r.id, details: { version, bytes: bytes.length } } });
  log('done');
}

main().catch(e => { console.error('[FAILED]', e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
