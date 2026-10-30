import sharp from 'sharp';

/**
 * Smaller copies of the stored photos (owner request 2026-10-30: the menu and the Mini App opened slowly because every card downloaded the original,
 * sometimes hundreds of KB to MB). The original bytes stay in the database untouched; a copy is made on the first request for a width, kept in a
 * bounded in-memory cache (keyed by the content hash, so a replaced photo never shows an old copy) and then cached hard by the browser/app like the
 * original. Nothing here can break a photo: any failure returns null and the caller sends the original.
 */
export const IMAGE_WIDTHS = [160, 320, 640, 1024] as const;
export const MAX_INPUT_PIXELS = 50_000_000; // a 7000 x 7000 photo; anything bigger is refused by sharp itself (decompression-bomb guard)
const CACHE_BYTES = 48 * 1024 * 1024;
const MAX_PARALLEL = 2;
const QUALITY = 78;

sharp.cache(false); // libvips keeps no file/operation cache of its own: ours is the only one
sharp.concurrency(1);

/** `?w=` -> the smallest allowed width that is at least that big (a request for 300 gets 320). Anything unreadable = no resizing. */
export function parseWidth(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{2,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return IMAGE_WIDTHS.find(w => w >= n) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

export interface Variant { mime: 'image/jpeg'; data: Buffer; etag: string }

const cache = new Map<string, Variant>(); // insertion order = least recently used first
let cacheBytes = 0;
const inflight = new Map<string, Promise<Variant | null>>();
const useOriginal = new Set<string>(); // keys whose copy would not be smaller: asked once, never again (bounded)
let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  try { return await work(); } finally { running--; waiting.shift()?.(); }
}

function remember(key: string, v: Variant): void {
  cache.set(key, v);
  cacheBytes += v.data.length;
  for (const [k, old] of cache) {
    if (cacheBytes <= CACHE_BYTES || k === key) break;
    cache.delete(k);
    cacheBytes -= old.data.length;
  }
}

/** The ETag of a copy; also what the 304 check compares against, so a cached copy needs no work at all. */
export const variantEtag = (sha256: string, width: number): string => `"${sha256}-w${width}"`;

/**
 * A JPEG copy of at most `width` pixels (never enlarged), turned upright by its EXIF orientation, transparency flattened to white.
 * Returns null when it is not worth sending (the copy is not smaller than the original) or when the image cannot be processed.
 */
export async function imageVariant(img: { data: Buffer; sha256: string }, width: number): Promise<Variant | null> {
  const key = `${img.sha256}:${width}`;
  if (useOriginal.has(key)) return null;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = slot(async (): Promise<Variant | null> => {
    try {
      const out = await sharp(img.data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();
      if (out.length >= img.data.length) { if (useOriginal.size > 5000) useOriginal.clear(); useOriginal.add(key); return null; }
      const v: Variant = { mime: 'image/jpeg', data: out, etag: variantEtag(img.sha256, width) };
      remember(key, v);
      return v;
    } catch {
      if (useOriginal.size > 5000) useOriginal.clear();
      useOriginal.add(key); // an image sharp cannot read is not retried on every request
      return null;
    }
  }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Test hook. */
export function _resetVariantCache(): void { cache.clear(); useOriginal.clear(); cacheBytes = 0; }
