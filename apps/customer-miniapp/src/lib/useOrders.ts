import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { groupOrders } from './orderList';
import type { OrderSummary } from './types';

const POLL_MS = 8000;

/** Loads the customer's orders, then refreshes them quietly while any is active (and when the app returns to the foreground). */
export function useOrders() {
  const [data, setData] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inflight = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (inflight.current) return;
    inflight.current = true;
    try { const r = await api.orders(signal); setData(r.orders); setError(null); }
    catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK')); }
    finally { inflight.current = false; }
  }, []);
  useEffect(() => { const ac = new AbortController(); void refresh(ac.signal); return () => ac.abort(); }, [refresh]);
  const anyActive = data ? groupOrders(data).active.length > 0 : true;
  useEffect(() => {
    if (!anyActive) return;
    let timer: number | undefined;
    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const start = () => { stop(); timer = window.setInterval(() => void refresh(), POLL_MS); };
    const vis = () => { if (document.hidden) stop(); else { void refresh(); start(); } };
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, [anyActive, refresh]);
  return { data, error, refresh };
}
