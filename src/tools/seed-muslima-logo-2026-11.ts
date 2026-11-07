import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: the restaurant photo of "Muslima kafe" is the logo the owner made (prisma/seed-assets/muslima-logo.jpg, 640 px).
 * Prints the plan unless --apply is given; safe to run twice. The restaurant is found by name ("Muslima"); nothing is written unless exactly one
 * restaurant matches, and a photo the restaurant already has is kept unless --replace is given.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-muslima-logo-2026-11.js --apply
 */
const APPLY = process.argv.includes('--apply');
const REPLACE = process.argv.includes('--replace');
const FILE = resolve(process.cwd(), 'prisma/seed-assets/muslima-logo.jpg');
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
      log(`${r.name} (${r.slug}): photo = muslima-logo.jpg (${bytes.length} bytes), version ${version}`);
      if (APPLY) {
        const img = { mime: 'image/jpeg', data: Uint8Array.from(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
        await db.restaurantImage.upsert({ where: { restaurantId: r.id }, create: { restaurantId: r.id, ...img, version }, update: { ...img, version } });
        await db.adminAuditEvent.create({ data: { actorId: 'owner-logo-20261107', action: 'RESTAURANT_IMAGE_SET', targetType: 'Restaurant', targetId: r.id, details: { source: 'muslima-logo.jpg', version } } });
      }
    }
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
