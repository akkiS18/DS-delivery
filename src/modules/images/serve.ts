import type { FastifyReply, FastifyRequest } from 'fastify';
import { imageVariant, parseWidth, variantEtag, type ImageFormat } from './variants.js';

const CACHE = 'public, max-age=2592000, immutable'; // the URL carries ?v=<version>, so a replaced photo has a new URL

/**
 * Sends a stored photo. With `?w=<pixels>` the caller gets a smaller copy when that is really smaller - WebP when its Accept header lists image/webp
 * (every Android WebView and Telegram does), JPEG otherwise; with no `w`, an unreadable `w`, a failure or a copy that is not smaller, the untouched
 * original, exactly as before.
 */
export async function sendImage(request: FastifyRequest, reply: FastifyReply, img: { mime: string; data: Buffer; sha256: string }): Promise<FastifyReply> {
  const width = parseWidth((request.query as { w?: unknown } | undefined)?.w);
  const inm = request.headers['if-none-match'];
  const format: ImageFormat = /image\/webp/i.test(String(request.headers.accept ?? '')) ? 'webp' : 'jpeg';
  if (width !== null) {
    reply.header('Vary', 'Accept'); // one URL, WebP or JPEG depending on the caller
    if (inm === variantEtag(img.sha256, width, format)) return reply.code(304).send();
    const copy = await imageVariant(img, width, format);
    if (copy) {
      return reply.header('Content-Type', copy.mime).header('X-Content-Type-Options', 'nosniff').header('ETag', copy.etag).header('Cache-Control', CACHE).send(copy.data);
    }
  }
  if (inm === `"${img.sha256}"`) return reply.code(304).send();
  return reply.header('Content-Type', img.mime).header('X-Content-Type-Options', 'nosniff').header('ETag', `"${img.sha256}"`).header('Cache-Control', CACHE).send(img.data);
}
