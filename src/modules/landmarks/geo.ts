/** Landmarks: named places people orient by. Pure helpers (no database): kinds, the service area, distances, the text a taxi driver reads. */

export const KINDS = ['MARKET', 'MOSQUE', 'SCHOOL', 'KINDERGARTEN', 'PHARMACY', 'HOSPITAL', 'BANK', 'SHOP', 'CAFE', 'GAS_STATION', 'BUS_STOP', 'OFFICE', 'OTHER'] as const;
export type LandmarkKind = (typeof KINDS)[number];
export const isKind = (x: unknown): x is LandmarkKind => typeof x === 'string' && (KINDS as readonly string[]).includes(x);

export interface Point { lat: number; lng: number }
export interface LandmarkPoint extends Point { id: string; name: string; kind: string }

/**
 * The area the map covers (Paxtachi district with a margin). A landmark outside it is almost always a typing slip (latitude and longitude swapped,
 * a lost digit), so it is refused. Keep in step with MAP_BOUNDS in apps/customer-miniapp/src/lib/mapConfig.ts.
 */
export const AREA = { west: 65.14, south: 39.69, east: 65.85, north: 40.19 } as const;
export const inArea = (p: Point): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lng >= AREA.west && p.lng <= AREA.east && p.lat >= AREA.south && p.lat <= AREA.north;

const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The landmarks within [maxMeters] of [p], nearest first (at most [limit]). */
export function nearbyLandmarks<T extends LandmarkPoint>(list: readonly T[], p: Point, maxMeters: number, limit = 1): Array<T & { meters: number }> {
  return list
    .map(l => ({ ...l, meters: distanceMeters(p, l) }))
    .filter(l => l.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "~150 m": rounded to 10 m (a precise-looking "137 m" would promise more than a map pin can). */
export const roundedMeters = (m: number): number => Math.max(10, Math.round(m / 10) * 10);

/** The line a driver reads: "Mo‘ljal: Markaziy bozor (~150 m)". */
export const landmarkLine = (name: string, meters: number): string => `Mo‘ljal: ${name} (~${roundedMeters(meters)} m)`;

/** Only landmarks this close are worth mentioning: farther away it stops being a way to find the house. */
export const NOTE_RADIUS_METERS = 700;
