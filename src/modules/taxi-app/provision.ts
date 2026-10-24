import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { generatePassword, slugFromName } from '../restaurant/provision.js';
import { setTaxiCredential } from './auth.js';

/**
 * Platform administrators give a taxi company its DS Taxi app login from Telegram. The password is shown once to the administrator (never
 * stored in clear, never written to the audit trail); a reset signs every device of that company out.
 */
const requireAdmin = (adminId: string): void => { if (!isSupportAdmin(adminId)) throw new Error('ADMIN_RUXSAT_YOQ'); };
const loginBase = (name: string): string => { const s = slugFromName(name); return s === 'restoran' ? 'taksi' : s; };

export async function createTaxiCompanyByAdmin(input: { adminId: string; name: string }): Promise<{ name: string; login: string; password: string }> {
  requireAdmin(input.adminId);
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new Error('NOM_QISQA');
  if (await db.taxiCompany.findUnique({ where: { name }, select: { id: true } })) throw new Error('KOMPANIYA_BOR');
  const company = await db.taxiCompany.create({ data: { name, isActive: true }, select: { id: true } });
  const out = await issueCredential(company.id, name);
  await db.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'TAXI_COMPANY_CREATED', targetType: 'TaxiCompany', targetId: company.id, details: { login: out.login } } });
  return { name, ...out };
}

/** New password for an existing company (creates the app login the first time). `ref` is the app login or the exact company name. */
export async function resetTaxiAccessByAdmin(input: { adminId: string; ref: string }): Promise<{ name: string; login: string; password: string } | null> {
  requireAdmin(input.adminId);
  const ref = input.ref.trim();
  const company = await db.taxiCompany.findFirst({
    where: { OR: [{ credential: { login: ref.toLowerCase() } }, { name: ref }] }, include: { credential: { select: { login: true } } },
  });
  if (!company) return null;
  const out = await issueCredential(company.id, company.name, company.credential?.login);
  await db.adminAuditEvent.create({ data: { actorId: input.adminId, action: company.credential ? 'TAXI_PASSWORD_RESET' : 'TAXI_LOGIN_CREATED', targetType: 'TaxiCompany', targetId: company.id, details: { login: out.login } } });
  return { name: company.name, ...out };
}

async function issueCredential(companyId: string, companyName: string, existingLogin?: string): Promise<{ login: string; password: string }> {
  const base = loginBase(companyName);
  for (let n = 1; n <= 30; n++) {
    const login = existingLogin ?? (n === 1 ? base : `${base.slice(0, 36)}-${n}`);
    const password = generatePassword(login);
    try {
      await setTaxiCredential({ companyId, login, password });
      return { login, password };
    } catch (err) {
      if (!(err instanceof Error && err.message === 'LOGIN_BAND') || existingLogin) throw err; // login taken by another company: try the next suffix
    }
  }
  throw new Error('LOGIN_BAND');
}
