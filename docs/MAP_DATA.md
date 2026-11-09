# Offline map (Paxtachi district, with Ziyovuddin)

The address form shows a street map taken from ONE file, `apps/customer-miniapp/public/map/paxtachi.pmtiles` (committed to git, 4.6 MB).
The same file is served at `/app/map/paxtachi.pmtiles` (Telegram Mini App, read in small pieces with HTTP Range) and is packed into the APK
(read once from the local assets, so it opens without internet). The map data is OpenStreetMap, so "© OpenStreetMap contributors" must stay
visible on the map (the map shows it in its corner).

Current file: Protomaps basemap build `20261109` (schema 4.15.2), cut with `pmtiles` 1.31.2, bounding box `65.14,39.69,65.85,40.19`,
max zoom 15, 5389 tiles. Libraries: `maplibre-gl` 6.17.0, `pmtiles` 4.5.0, `@protomaps/basemaps` 5.7.2 (exact versions in `apps/customer-miniapp/package.json`).

## Remake the file (new map data, or another area)

1. Download the `pmtiles` command-line tool from https://github.com/protomaps/go-pmtiles/releases (Windows x86_64 zip) and check its SHA-256 against the release page.
2. Pick the newest daily build from https://build-metadata.protomaps.dev/builds.json (a key like `20261109.pmtiles`).
3. Cut the area (Paxtachi district bounding box from OpenStreetMap, plus a margin):

```
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles apps/customer-miniapp/public/map/paxtachi.pmtiles --bbox=65.14,39.69,65.85,40.19 --maxzoom=15
pmtiles show apps/customer-miniapp/public/map/paxtachi.pmtiles
```

The bounding box must match `MAP_BOUNDS` in `apps/customer-miniapp/src/lib/mapConfig.ts` (the map cannot be dragged outside it). A new file changes
the APK size and the Mini App download: rebuild and release both. Keep the `@protomaps/basemaps` major version in step with the schema of the build.

## How it works / gotchas found while building it

- `MapPicker.tsx` is the only file that imports the map libraries, and it is loaded on demand (own 307 KB gzip chunk; the first screen did not grow).
- maplibre-gl 6 starts its tile decoder from a separate file. It is imported with `?url` and given to `setWorkerUrl`, so it ships as an asset of the app
  (same origin; the server CSP allows `worker-src 'self' blob:`).
- maplibre's own CSS sets `.maplibregl-map { position: relative }`; `.map-box .map-canvas` in `styles.css` is written to win over it. Without it the map has height 0 and never loads.
- The map draws roads, buildings and land only: no text labels (that needs font files). Place names are stage 3 (landmarks).
- If the file is missing, WebGL fails or the map does not load in 15 seconds, the form falls back to the text address and the old "add location" button.

## Checks done on 2026-11-09 (desktop Chrome, headless)

- The map loads (`state ready`), draws roads, the pin stays in the centre, dragging picks a place (`lat 40.030565, lng 65.667848`) and shows "Joy belgilandi".
- `curl`-style Range reads answer 206 with `Content-Range` (tested in `src/tests/miniapp.db.test.ts`); Mini App unit tests, root `tsc`, `test:taxi`, `test:miniapp:db`, `test:taxi:db` pass.
- Android web bundle (`vite build --mode android`) contains the map file and the worker.

## Not checked yet

- A real phone: the APK itself (Capacitor serving the local `.pmtiles` and the `.mjs` worker, `fetch` with CapacitorHttp enabled), the Telegram Mini App on a phone, speed on a weak phone.
- At zoom 17 in the middle of Ziyovuddin OpenStreetMap shows only a few roads and no buildings: the town is thinly mapped. That is why stage 3 adds our own landmarks layer.
- `npm run test:qa:ui` has 12 failing checks (basket button, orders list) that fail identically without these changes.
