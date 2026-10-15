import { z } from 'zod';
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  INTERNAL_API_KEY: z.string().min(20, 'INTERNAL_API_KEY kamida 20 ta belgi bo‘lsin'),
  GMAIL_ENABLED: z.enum(['true', 'false']).default('false'),
  BOT_ENABLED: z.enum(['true', 'false']).default('false'),
  BOT_TOKEN: z.string().optional(),
});
export const env = envSchema.parse(process.env);
