import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: the restaurant photo of "Muslima kafe" is the new wide picture the owner made (prisma/seed-assets/muslima-kafe.webp, 1024 px wide WebP).
 * Prints the plan unless --apply is given; safe to run twice. The restaurant is found by name ("Muslima"); nothing is written unless exactly one
 * restaurant matches, and a photo the restaurant already has is kept unless --replace is given.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-muslima-photo-2026-11-07.js --apply --replace
 */
const APPLY = process.argv.includes('--apply');
const REPLACE = process.argv.includes('--replace');
const FILE = resolve(process.cwd(), 'prisma/seed-assets/muslima-kafe.webp');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

try {
  const rows = await db.restaurant.findMany({ where: { name: { contains: 'muslima', mode: 'insensitive' } }, select: { id: true, slug: true, name: true, image: { select: { version: true } } } });
  if (rows.length !== 1) { log(`${rows.length} restaurants match "Muslima" (${rows.map(r => r.slug).join(', ') || 'none'}): nothing written`); }
  else {
    const r = rows[0]!;
    if (r.image && !REPLACE) log(`${r.name} (${r.slug}): already has a photo (v${r.image.version}), kept (use --replace to change it)`);
    else {
      const bytes = readFileSync(FILE);
      const version = (r.image?.version ?? 0) + 1;
      log(`${r.name} (${r.slug}): photo = muslima-kafe.webp (${bytes.length} bytes), version ${version}`);
      if (APPLY) {
        const img = { mime: 'image/webp', data: Uint8Array.from(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
        await db.restaurantImage.upsert({ where: { restaurantId: r.id }, create: { restaurantId: r.id, ...img, version }, update: { ...img, version } });
        await db.adminAuditEvent.create({ data: { actorId: 'owner-photo-20261107b', action: 'RESTAURANT_IMAGE_SET', targetType: 'Restaurant', targetId: r.id, details: { source: 'muslima-kafe.webp', version } } });
      }
    }
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
