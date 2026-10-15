import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from './env.js';
export function requireInternal(request: FastifyRequest): void {
  const actual = request.headers['x-internal-api-key'];
  const value = typeof actual === 'string' ? actual : '';
  const a = Buffer.from(value);
  const b = Buffer.from(env.INTERNAL_API_KEY);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const error = new Error('Unauthorized') as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }
}
