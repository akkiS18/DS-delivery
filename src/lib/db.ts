import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from './test-db-guard.js';
assertTestDatabase();
export const db = new PrismaClient();
