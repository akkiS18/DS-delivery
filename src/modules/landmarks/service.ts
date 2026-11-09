import { db } from '../../lib/db.js';
import { needAdmin } from '../promotions/service.js';
import { distanceMeters, inArea, isKind, landmarkLine, nearbyLandmarks, NOTE_RADIUS_METERS, type LandmarkPoint } from './geo.js';

/**
 * Landmarks (owner 2026-11-09): the administrator adds named places in the DS Admin app; customers see them on the map and the taxi gets the
 * nearest one as a text line. Orders never reference a landmark (they keep their own text), so deleting one can never break an order.
 */
export const MAX_LANDMARKS = 1000;
const DUPLICATE_RADIUS_METERS = 150;

export const cleanName = (raw: string): string => {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 60) throw new Error('NOM_NOTOGRI');
  return s;
};

const audit = (adminId: string, action: string, id: string, details: Record<string, unknown>) =>
  db.adminAuditEvent.create({ data: { actorId: adminId, action, targetType: 'Landmark', targetId: id, details: details as never } });

// ------------------------------------------------------------------ what customers and the taxi read (active ones, cached briefly)
const TTL_MS = 30_000;
let cache: { at: number; rows: LandmarkPoint[] } | null = null;
export const clearLandmarkCache = (): void => { cache = null; };

export async function activeLandmarks(nowMs = Date.now()): Promise<LandmarkPoint[]> {
  if (cache && nowMs - cache.at < TTL_MS) return cache.rows;
  const rows = await db.landmark.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, kind: true, lat: true, lng: true } });
  cache = { at: nowMs, rows };
  return rows;
}
/** The last loaded list without waiting (empty before the first load). For code that cannot be async; callers warm it with activeLandmarks() first. */
export const peekLandmarks = (): LandmarkPoint[] => cache?.rows ?? [];

/** "Mo‘ljal: Markaziy bozor (~150 m)" for a delivery point, or null (no point, or no landmark close enough). */
export function landmarkNote(lat: number | null | undefined, lng: number | null | undefined, list: readonly LandmarkPoint[] = peekLandmarks()): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const [hit] = nearbyLandmarks(list, { lat, lng }, NOTE_RADIUS_METERS, 1);
  return hit ? landmarkLine(hit.name, hit.meters) : null;
}

// ------------------------------------------------------------------ the administrator's list and changes
export async function adminLandmarks(adminId: string) {
  needAdmin(adminId);
  const rows = await db.landmark.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, kind: true, lat: true, lng: true, isActive: true, createdAt: true } });
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export interface LandmarkInput { name: string; kind: string; lat: number; lng: number }

async function assertNotDuplicate(name: string, lat: number, lng: number, exceptId?: string): Promise<void> {
  const same = await db.landmark.findMany({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { lat: true, lng: true } });
  if (same.some(s => distanceMeters({ lat, lng }, s) <= DUPLICATE_RADIUS_METERS)) throw new Error('LANDMARK_EXISTS');
}

export async function createLandmark(adminId: string, input: LandmarkInput): Promise<{ id: string }> {
  needAdmin(adminId);
  const name = cleanName(input.name);
  if (!isKind(input.kind)) throw new Error('TUR_NOTOGRI');
  if (!inArea({ lat: input.lat, lng: input.lng })) throw new Error('HUDUDDAN_TASHQARI');
  if ((await db.landmark.count()) >= MAX_LANDMARKS) throw new Error('JOYLAR_LIMITI');
  await assertNotDuplicate(name, input.lat, input.lng);
  const row = await db.landmark.create({ data: { name, kind: input.kind, lat: input.lat, lng: input.lng, createdBy: adminId }, select: { id: true } });
  await audit(adminId, 'LANDMARK_CREATED', row.id, { name, kind: input.kind, lat: input.lat, lng: input.lng });
  clearLandmarkCache();
  return row;
}

export interface LandmarkPatch { name?: string; kind?: string; lat?: number; lng?: number; isActive?: boolean }
/** The point moves only with both coordinates. Several changes together are written as one update. */
export async function updateLandmark(adminId: string, id: string, patch: LandmarkPatch): Promise<void> {
  needAdmin(adminId);
  const cur = await db.landmark.findUnique({ where: { id }, select: { id: true, name: true, kind: true, lat: true, lng: true, isActive: true } });
  if (!cur) throw new Error('JOY_TOPILMADI');
  if ((patch.lat === undefined) !== (patch.lng === undefined)) throw new Error('HUDUDDAN_TASHQARI');
  const data: { name?: string; kind?: string; lat?: number; lng?: number; isActive?: boolean } = {};
  if (patch.name !== undefined) data.name = cleanName(patch.name);
  if (patch.kind !== undefined) { if (!isKind(patch.kind)) throw new Error('TUR_NOTOGRI'); data.kind = patch.kind; }
  if (patch.lat !== undefined && patch.lng !== undefined) {
    if (!inArea({ lat: patch.lat, lng: patch.lng })) throw new Error('HUDUDDAN_TASHQARI');
    data.lat = patch.lat; data.lng = patch.lng;
  }
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (!Object.keys(data).length) return;
  if (data.name !== undefined || data.lat !== undefined) await assertNotDuplicate(data.name ?? cur.name, data.lat ?? cur.lat, data.lng ?? cur.lng, id);
  await db.landmark.update({ where: { id }, data });
  await audit(adminId, 'LANDMARK_UPDATED', id, { before: cur, change: data });
  clearLandmarkCache();
}

export async function deleteLandmark(adminId: string, id: string): Promise<void> {
  needAdmin(adminId);
  const cur = await db.landmark.findUnique({ where: { id }, select: { id: true, name: true, kind: true, lat: true, lng: true } });
  if (!cur) throw new Error('JOY_TOPILMADI');
  await db.landmark.delete({ where: { id } });
  await audit(adminId, 'LANDMARK_DELETED', id, { ...cur });
  clearLandmarkCache();
}
