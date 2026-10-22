import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './lib/api';
import { cartReducer, emptyCart, loadCart, saveCart, type CartAction } from './lib/cart';
import { parseRoute, routeToHash, type Route } from './lib/router';
import type { AppConfig, CartState, Profile } from './lib/types';

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

interface Ctx {
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  config: AppConfig | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  reload: () => void;
  cart: CartState;
  dispatch: (a: CartAction) => void;
  toast: (message: string) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = (): Ctx => { const c = useContext(AppCtx); if (!c) throw new Error('AppProvider missing'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => loadCart(storage()));
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { saveCart(storage(), cart); }, [cart]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading');
    try {
      const [c, p] = await Promise.all([api.config(signal), api.me(signal)]);
      setConfig(c); setProfile(p); setError(null); setStatus('ready');
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); setStatus('error');
    }
  }, []);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal); return () => ac.abort(); }, [load, nonce]);

  const refreshProfile = useCallback(async () => { try { setProfile(await api.me()); } catch { /* keep what we have */ } }, []);
  const toast = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 3200);
  }, []);

  const value = useMemo<Ctx>(() => ({ status, error, config, profile, refreshProfile, reload: () => setNonce(n => n + 1), cart, dispatch, toast }),
    [status, error, config, profile, refreshProfile, cart, toast]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      {message && <div className="toast" role="status"><div>{message}</div></div>}
    </AppCtx.Provider>
  );
}

// ---- routing
export function useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route, opts?: { replace?: boolean }) => {
    const hash = routeToHash(r);
    if (opts?.replace) window.location.replace(`${window.location.pathname}${window.location.search}${hash}`);
    else window.location.hash = hash;
  }, []);
  return [route, go];
}

// ---- helpers
/** Loads data once per dependency change; aborts on unmount; exposes reload. */
export function useLoad<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): { data: T | null; error: ApiError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fn(ac.signal).then(d => { setData(d); setError(null); setLoading(false); }).catch(e => {
      if ((e as { name?: string }).name === 'AbortError') return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); setLoading(false);
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN(x => x + 1) };
}

/** performance.now() ticking every `periodMs`, paused while the page is hidden (no CPU in the background). */
export function useNow(periodMs: number, enabled = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!enabled) return;
    let id: number | undefined;
    const start = () => { stop(); setNow(performance.now()); id = window.setInterval(() => setNow(performance.now()), periodMs); };
    const stop = () => { if (id !== undefined) window.clearInterval(id); id = undefined; };
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [periodMs, enabled]);
  return now;
}

export { emptyCart };
