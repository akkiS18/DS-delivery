import sharp from 'sharp';
import { MAX_INPUT_PIXELS } from './variants.js';

/**
 * Owner request 2026-11-22: on the home screen a restaurant card shows its LOGO whole, and the space left and right of a square logo is filled
 * with the logo's own background colour (no blurred copy, no icons; the icon picture is only the menu header background).
 * The card frame is about 2.1:1 with object-fit: cover, so the logo is put on a 3:1 canvas: the frame then trims only plain colour at the sides,
 * never the logo. Made on the first request and kept in a small in-memory map keyed by the logo's hash (a new logo = a new key).
 * Any failure returns null and the caller falls back to the plain logo.
 */
export const LOGO_WIDE_RATIO = 3;
const H = 600;
const LOGO_SHARE = 0.92; // a little room above and below: the card's 4 % zoom never cuts the logo's edge
const MAX_ENTRIES = 64;

export interface WidePicture { mime: 'image/webp'; data: Buffer; sha256: string }
const cache = new Map<string, WidePicture>();
const inflight = new Map<string, Promise<WidePicture | null>>();

/** Pure: per-channel median of the pixels in the outer `band` columns on both sides of an RGB raw buffer. */
export function edgeColour(raw: Buffer, width: number, height: number, band: number): { r: number; g: number; b: number } {
  const ch: number[][] = [[], [], []];
  const b = Math.max(1, Math.min(band, Math.floor(width / 2)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= b && x < width - b) continue;
      const i = (y * width + x) * 3;
      ch[0]!.push(raw[i]!); ch[1]!.push(raw[i + 1]!); ch[2]!.push(raw[i + 2]!);
    }
  }
  const med = (a: number[]): number => a.sort((p, q) => p - q)[a.length >> 1] ?? 0;
  return { r: med(ch[0]!), g: med(ch[1]!), b: med(ch[2]!) };
}

export async function logoOnWide(logo: { data: Buffer; sha256: string }): Promise<WidePicture | null> {
  const key = `${logo.sha256}-wide${LOGO_WIDE_RATIO}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async (): Promise<WidePicture | null> => {
    try {
      const inner = Math.round(H * LOGO_SHARE);
      const resized = await sharp(logo.data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate()
        .resize({ width: inner, height: inner, fit: 'inside' }).flatten({ background: '#ffffff' }).removeAlpha()
        .raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h } = resized.info;
      const bg = edgeColour(resized.data, w, h, Math.max(2, Math.round(w / 50)));
      const W = H * LOGO_WIDE_RATIO;
      const left = Math.floor((W - w) / 2), top = Math.floor((H - h) / 2);
      const data = await sharp(resized.data, { raw: { width: w, height: h, channels: 3 } })
        .extend({ left, right: W - w - left, top, bottom: H - h - top, background: bg })
        .webp({ quality: 82, effort: 4 }).toBuffer();
      const pic: WidePicture = { mime: 'image/webp', data, sha256: key };
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, pic);
      return pic;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
