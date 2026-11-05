import type { FastifyInstance } from 'fastify';
import { legalConfig, renderLegalPage, type LegalKind } from './pages.js';

/** Public, static, cacheable for a few minutes. Own CSP: no scripts at all. */
export async function legalRoutes(app: FastifyInstance): Promise<void> {
  for (const [path, kind] of [['/legal/privacy', 'privacy'], ['/legal/terms', 'terms'], ['/legal/delete-account', 'delete-account']] as Array<[string, LegalKind]>) {
    app.get(path, { config: { public: true } }, async (_request, reply) => {
      const cfg = legalConfig();
      if (!cfg) return reply.code(503).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('Hujjat hali tayyor emas.');
      return reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        .header('Cache-Control', 'public, max-age=300').header('X-Content-Type-Options', 'nosniff')
        .type('text/html; charset=utf-8').send(renderLegalPage(kind, cfg));
    });
  }
}
