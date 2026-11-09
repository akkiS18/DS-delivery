import { LocateFixed, MapPin } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre 6 starts its tile decoder from a separate file. Bundled, that file would not sit next to the library, so it is shipped as an asset
// of our own (same origin: allowed by the Content-Security-Policy, and packed into the APK).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { PMTiles, Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { insideBounds, MAP_BOUNDS, MAP_FILE, roundPoint, TOWN_CENTER, type LatLng, type MapState } from '../lib/mapConfig';
import { BufferSource, loadWholeFile } from '../lib/mapSource';
import { isAndroidApp } from '../lib/platform';
import { Icon } from './ui';

interface Props {
  /** The place the customer already chose (saved address, or an earlier pick); null = nothing chosen yet. */
  value: LatLng | null;
  onPick: (p: LatLng) => void;
  onState: (s: MapState) => void;
}

const LOAD_TIMEOUT_MS = 15_000;
let protocol: Protocol | null = null;
function pmtilesProtocol(): Protocol {
  if (!protocol) {
    maplibregl.setWorkerUrl(new URL(workerUrl, document.baseURI).href);
    protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  }
  return protocol;
}

/** Street map from the offline file. No text labels from the map itself (no font files): the places are drawn by the app (landmarks, later). */
function buildStyle(key: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { protomaps: { type: 'vector', url: `pmtiles://${key}`, attribution: '© OpenStreetMap contributors' } },
    layers: layers('protomaps', namedFlavor('light')).filter(l => l.type !== 'symbol') as unknown as maplibregl.StyleSpecification['layers'],
  };
}

/**
 * The customer moves the map under a fixed pin; where the pin stands when the map stops is the delivery point (works for another address or
 * another person too, not only "where my phone is"). Loaded on demand (maplibre is large); reports `failed` so the screen can fall back to text.
 */
export default function MapPicker({ value, onPick, onState }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const report = useRef(onState); report.current = onState;
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState(value !== null);

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let map: maplibregl.Map | null = null;
    report.current('loading');
    const timer = window.setTimeout(() => { if (!ready && !cancelled) report.current('failed'); }, LOAD_TIMEOUT_MS);
    void (async () => {
      try {
        const url = new URL(MAP_FILE, document.baseURI).href;
        const archive = isAndroidApp ? new PMTiles(new BufferSource(url, await loadWholeFile(url))) : new PMTiles(url);
        await archive.getHeader(); // a missing or broken file fails here, before any map is drawn
        if (cancelled || !box.current) return;
        pmtilesProtocol().add(archive);
        const start = value ?? TOWN_CENTER;
        map = new maplibregl.Map({
          container: box.current,
          style: buildStyle(url),
          center: [start.lng, start.lat], zoom: value ? 17 : 15, minZoom: 11, maxZoom: 19,
          maxBounds: [[MAP_BOUNDS[0], MAP_BOUNDS[1]], [MAP_BOUNDS[2], MAP_BOUNDS[3]]],
          attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;
        map.on('load', () => { ready = true; window.clearTimeout(timer); report.current('ready'); });
        map.on('error', e => console.warn('[map] error', e.error)); // a bad tile or style layer shows up in the console instead of a silent empty map
        // Only the customer's own gesture picks a place (originalEvent is absent when the code moves the map), so opening the map never
        // silently "chooses" the default centre.
        map.on('moveend', e => {
          if (!(e as { originalEvent?: unknown }).originalEvent || !map) return;
          const c = map.getCenter();
          pick.current(roundPoint({ lat: c.lat, lng: c.lng }));
          setChosen(true); setNote('');
        });
      } catch (err) {
        console.warn('[map] unavailable, using the text address', err);
        if (!cancelled) report.current('failed');
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timer); map?.remove(); mapRef.current = null; };
    // The starting point (`value`) is read once on purpose; later moves come from the map itself.
  }, []);

  const locate = () => {
    if (!navigator.geolocation) { setNote(t('Joylashuvni aniqlab bo‘lmadi')); return; }
    navigator.geolocation.getCurrentPosition(
      p => {
        const here = roundPoint({ lat: p.coords.latitude, lng: p.coords.longitude });
        if (!insideBounds(here)) { setNote(t('Siz xarita hududidan tashqaridasiz — pinni qo‘lda qo‘ying')); return; }
        mapRef.current?.easeTo({ center: [here.lng, here.lat], zoom: 17, duration: 500 });
        pick.current(here); setChosen(true); setNote('');
      },
      () => setNote(t('Joylashuvga ruxsat berilmadi')), { timeout: 8000, maximumAge: 60_000 });
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="map-box">
        <div ref={box} className="map-canvas" role="application" aria-label={t('Xarita')} />
        <div className="map-pin" aria-hidden><Icon as={MapPin} size={40} /></div>
        <button type="button" className="map-locate" onClick={locate} aria-label={t('Joylashuvim')}><Icon as={LocateFixed} size={22} /></button>
      </div>
      <div className={`small ${note ? 'err' : 'sub'}`} role="status">
        {note || (chosen ? t('Joy belgilandi') : t('Xaritani suring: belgi uyingiz ustida tursin'))}
      </div>
    </div>
  );
}
