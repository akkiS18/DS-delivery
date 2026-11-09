/** Map constants and pure helpers (no map library here, so they are testable without a browser). */

export interface LatLng { lat: number; lng: number }

/** loading: the map is being prepared; ready: it works; failed: no map (file missing, no WebGL, timeout) and the screen uses the text address. */
export type MapState = 'loading' | 'ready' | 'failed';

/** Ziyovuddin town centre (OpenStreetMap, 2026-11-09): where the map opens when the customer has not chosen a place yet. */
export const TOWN_CENTER: LatLng = { lat: 40.0304, lng: 65.6672 };

/** Paxtachi district with a small margin: [west, south, east, north]. The map cannot be dragged outside it and the offline file covers only it. */
export const MAP_BOUNDS: readonly [number, number, number, number] = [65.14, 39.69, 65.85, 40.19];

/** The offline map file, relative to the app (public/map/). The same file ships in the web build and inside the APK. */
export const MAP_FILE = 'map/paxtachi.pmtiles';

export const insideBounds = (p: LatLng): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lng >= MAP_BOUNDS[0] && p.lng <= MAP_BOUNDS[2] && p.lat >= MAP_BOUNDS[1] && p.lat <= MAP_BOUNDS[3];

/** Six decimals (about 10 cm) is what the server stores; more only makes the order text longer. */
export const roundPoint = (p: LatLng): LatLng => ({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });
