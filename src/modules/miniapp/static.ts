import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseRange } from './byte-range.js';
import { miniAppEnabled } from './routes.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/** Telegram clients render the Mini App in a webview / iframe, so framing is allowed for Telegram origins only. */
export const MINIAPP_CSP = [
  "default-src 'self'", "script-src 'self' https://telegram.org", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
  "font-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
  "worker-src 'self' blob:", "child-src 'self' blob:", // the map library runs its tile decoder in a worker built from a blob
  'frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org https://*.telegram.org',
].join('; ');

export function miniAppDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.MINIAPP_DIST_DIR?.trim() || path.join(process.cwd(), 'apps', 'customer-miniapp', 'dist'));
}

/**
 * Serves the built Mini App at /app/ from the same origin as the API (one HTTPS URL for BotFather, no CORS). Read-only, path-traversal
 * safe, SPA fallback only for extension-less paths. Disabled (404) unless MINIAPP_ENABLED=true.
 */
export async function registerMiniAppStatic(app: FastifyInstance, distDir = miniAppDistDir()): Promise<void> {
  const root = path.resolve(distDir);
  const send = async (rel: string, reply: import('fastify').FastifyReply, range?: string) => {
    if (!miniAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
    let target = path.resolve(root, '.' + path.sep + rel);
    if (target !== root && !target.startsWith(root + path.sep)) return reply.code(404).send({ error: 'NOT_FOUND' }); // traversal
    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) { target = path.join(target, 'index.html'); info = await stat(target).catch(() => null); }
    if (!info?.isFile()) {
      if (path.extname(rel)) return reply.code(404).send({ error: 'NOT_FOUND' }); // a missing asset is a 404, not index.html
      target = path.join(root, 'index.html');
      info = await stat(target).catch(() => null);
      if (!info?.isFile()) return reply.code(503).send({ error: 'MINIAPP_NOT_BUILT' });
    }
    const ext = path.extname(target).toLowerCase();
    const hashedAsset = rel.startsWith('assets/');
    reply.header('Content-Type', TYPES[ext] ?? 'application/octet-stream')
      .header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', hashedAsset ? 'public, max-age=31536000, immutable' : 'no-store');
    if (ext === '.html' && process.env.MINIAPP_CSP !== 'off') reply.header('Content-Security-Policy', MINIAPP_CSP);
    if (ext === '.pmtiles') {
      // The offline map is one big file read in small pieces (HTTP Range), so it is never loaded whole into memory. Cached briefly: a new map
      // file is a release, and the browser must not mix pieces of an old and a new file for long.
      const size = (await stat(target)).size;
      const r = parseRange(range, size);
      reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'public, max-age=300');
      if (r.kind === 'unsatisfiable') return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      if (r.kind === 'partial') {
        const length = r.end - r.start + 1;
        const handle = await open(target, 'r');
        try {
          const buf = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buf, 0, length, r.start);
          return reply.code(206).header('Content-Range', `bytes ${r.start}-${r.start + bytesRead - 1}/${size}`).send(buf.subarray(0, bytesRead));
        } finally { await handle.close(); }
      }
      return reply.header('Content-Length', size).send(createReadStream(target));
    }
    return reply.send(await readFile(target));
  };
  app.get('/app', async (_req, reply) => reply.redirect('/app/'));
  app.get('/app/', async (_req, reply) => send('index.html', reply));
  app.get<{ Params: { '*': string } }>('/app/*', async (req, reply) => {
    let rel: string;
    try { rel = decodeURIComponent(req.params['*']); } catch { return reply.code(400).send({ error: 'BAD_PATH' }); }
    if (rel.includes('\0')) return reply.code(400).send({ error: 'BAD_PATH' });
    return send(rel, reply, req.headers.range);
  });
}
