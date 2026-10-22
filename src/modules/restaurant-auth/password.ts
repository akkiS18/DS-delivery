import * as nodeCrypto from 'node:crypto';

/** Argon2id via Node's built-in crypto (Node.js >= 24.7). No third-party dependency is installed. */
type Argon2 = (
  algorithm: 'argon2id',
  params: { message: string; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  callback: (err: Error | null, key: Buffer) => void,
) => void;
const argon2 = (nodeCrypto as unknown as { argon2?: Argon2 }).argon2;

/** OWASP-recommended minimum profile: 19 MiB, 2 passes, 1 lane. */
export const ARGON2 = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 200;

// Memory is the scarce resource of Argon2; never run more than a few hashes at once.
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

function derive(password: string, salt: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  if (!argon2) return Promise.reject(new Error('ARGON2_UNAVAILABLE: Node.js 24.7+ kerak'));
  return withSlot(() => new Promise<Buffer>((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) => (err ? reject(err) : resolve(key)));
  }));
}
const b64 = (b: Buffer): string => b.toString('base64').replace(/=+$/, '');

/** PHC string: $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = nodeCrypto.randomBytes(16);
  const key = await derive(password, salt, ARGON2);
  return `$argon2id$v=19$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$${b64(salt)}$${b64(key)}`;
}

/** Constant-time comparison. A malformed or over-expensive stored hash simply fails verification. */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return false;
  const memory = Number(m[1]); const passes = Number(m[2]); const parallelism = Number(m[3]);
  if (memory < 8 * parallelism || memory > 262_144 || passes < 1 || passes > 10 || parallelism < 1 || parallelism > 4) return false;
  const salt = Buffer.from(m[4]!, 'base64');
  const expected = Buffer.from(m[5]!, 'base64');
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
  const actual = await derive(password, salt, { memory, passes, parallelism, tagLength: expected.length });
  return nodeCrypto.timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** Verified against when the restaurant/credential does not exist, so both paths cost the same. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(nodeCrypto.randomBytes(18).toString('base64url'));
  return dummy;
}

/** Provisioning policy (login itself accepts any 1..200 characters so the policy is not revealed). */
export function assertPasswordPolicy(password: string, slug: string): void {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new Error(`PAROL_UZUNLIGI: ${MIN_PASSWORD}–${MAX_PASSWORD} belgi bo‘lsin`);
  }
  if (new Set(password).size < 5) throw new Error('PAROL_OSON: kamida 5 xil belgi ishlating');
  if (password.toLowerCase().includes(slug.toLowerCase())) throw new Error('PAROL_OSON: parol restoran slug‘ini o‘z ichiga olmasin');
}
