import type { LatLng } from './mapConfig';

/** A named place (market, mosque, school...) added by the administrator. Customers see it on the address map and as a quick "near me" choice. */
export interface Landmark { id: string; name: string; kind: string; lat: number; lng: number }
export type NearLandmark = Landmark & { meters: number };

const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres (haversine); the same formula as the server's (src/modules/landmarks/geo.ts). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The landmarks within [maxMeters] of [p], nearest first (ties by name so the list never flickers), at most [limit]. */
export function nearbyLandmarks(list: readonly Landmark[], p: LatLng, maxMeters: number, limit: number): NearLandmark[] {
  return list
    .map(l => ({ ...l, meters: distanceMeters(p, l) }))
    .filter(l => l.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Rounded to 10 m: a map pin cannot promise "137 m". */
export const roundedMeters = (m: number): number => Math.max(10, Math.round(m / 10) * 10);

/** How far a landmark may be to be offered next to the pin, and how many are offered. */
export const CHIP_RADIUS_METERS = 800;
export const CHIP_COUNT = 3;
/** Beyond this the landmark is not worth naming as "near" the chosen spot. */
export const NOTE_RADIUS_METERS = 700;
