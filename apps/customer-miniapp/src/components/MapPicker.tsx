import { LocateFixed, MapPin } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre 6 starts its tile decoder from a separate file. Bundled, that file would not sit next to the library, so it is shipped as an asset
// of our own (same origin: allowed by the Content-Security-Policy, and packed into the APK).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { PMTiles, Protocol } from 'pmtiles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { rich } from '../i18n/rich';
import { api } from '../lib/api';
import { CHIP_COUNT, CHIP_RADIUS_METERS, NOTE_RADIUS_METERS, nearbyLandmarks, roundedMeters, type Landmark } from '../lib/landmarks';
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
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [center, setCenter] = useState<LatLng>(value ?? TOWN_CENTER);
  const [mapReady, setMapReady] = useState(false);

  // The administrator's places (market, mosque...). Without them (offline, error) the map simply works without names.
  useEffect(() => {
    const ac = new AbortController();
    api.landmarks(ac.signal).then(r => setLandmarks(r.landmarks)).catch(() => { /* optional */ });
    return () => ac.abort();
  }, []);

  /** Puts the pin on a landmark (a tap on its chip or its marker); the customer can still move the map from there. */
  const chooseLandmark = (l: Landmark) => {
    const map = mapRef.current;
    map?.easeTo({ center: [l.lng, l.lat], zoom: Math.max(map.getZoom(), 17), duration: 400 });
    pick.current(roundPoint(l)); setChosen(true); setNote('');
  };
  const chooseRef = useRef(chooseLandmark); chooseRef.current = chooseLandmark;

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
        // Names show only when zoomed in; farther out the places are plain dots (and very far out, hidden) so they never pile up.
        const syncZoom = () => { if (box.current) box.current.dataset.lm = map!.getZoom() >= 16 ? 'label' : map!.getZoom() >= 14 ? 'dot' : 'none'; };
        map.on('zoom', syncZoom);
        map.on('load', () => { ready = true; window.clearTimeout(timer); syncZoom(); setMapReady(true); report.current('ready'); });
        map.on('error', e => console.warn('[map] error', e.error)); // a bad tile or style layer shows up in the console instead of a silent empty map
        // Only the customer's own gesture picks a place (originalEvent is absent when the code moves the map), so opening the map never
        // silently "chooses" the default centre.
        map.on('moveend', e => {
          if (!map) return;
          const c = map.getCenter();
          setCenter({ lat: c.lat, lng: c.lng }); // every move updates the "near here" list; only the customer's own gesture picks
          if (!(e as { originalEvent?: unknown }).originalEvent) return;
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

  // One marker per landmark (a plain element: the name is set as text, never as HTML).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = landmarks.map(l => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'lm'; el.setAttribute('aria-label', l.name);
      const dot = document.createElement('i');
      const label = document.createElement('span'); label.textContent = l.name;
      el.append(dot, label);
      el.addEventListener('click', ev => { ev.stopPropagation(); chooseRef.current(l); });
      return new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([l.lng, l.lat]).addTo(map);
    });
    return () => markers.forEach(m => m.remove());
  }, [landmarks, mapReady]);

  const chips = useMemo(() => nearbyLandmarks(landmarks, center, CHIP_RADIUS_METERS, CHIP_COUNT), [landmarks, center]);
  const nearest = chosen ? nearbyLandmarks(landmarks, center, NOTE_RADIUS_METERS, 1)[0] : undefined;

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
        {!chosen && !note && <span className="map-hint">{t('Xaritani suring: belgi uyingiz ustida tursin')}</span>}
      </div>
      {note
        ? <div className="small err" role="status">{note}</div>
        : nearest
          ? <div className="map-near" role="status"><Icon as={MapPin} size={18} /><span>{rich('Eng yaqin mo‘ljal: <b>{name}</b> (~{m} m)', { name: nearest.name, m: roundedMeters(nearest.meters) })}</span></div>
          : chosen ? <div className="small sub" role="status">{t('Joy belgilandi')}</div> : null}
      {chips.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small sub">{t('Yaqin joylar')}</div>
          <div className="chips wrap">
            {chips.map(l => <button key={l.id} type="button" className="chip" onClick={() => chooseLandmark(l)}>{l.name} · {t('{n} m', { n: roundedMeters(l.meters) })}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
