import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { LatLng, MapState } from '../lib/mapConfig';
import { Spinner } from './ui';

// The map library is large: it is fetched only when an address form is opened, never with the first screen.
const MapPicker = lazy(() => import('./MapPicker'));

/** A failed download of the map code (offline, old cache) must not break the checkout: the screen falls back to the text address. */
class Guard extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[map] code failed to load', err); this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function LocationPicker({ value, onPick, onState }: { value: LatLng | null; onPick: (p: LatLng) => void; onState: (s: MapState) => void }) {
  return (
    <Guard onFail={() => onState('failed')}>
      <Suspense fallback={<div className="map-box"><Spinner /></div>}>
        <MapPicker value={value} onPick={onPick} onState={onState} />
      </Suspense>
    </Guard>
  );
}
