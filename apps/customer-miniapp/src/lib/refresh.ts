import { useEffect, useState } from 'react';

/**
 * Keeps the screen current without the customer closing the app:
 *  - pull down at the top of a page -> `epoch` changes (the caller re-mounts the screen, which loads everything again);
 *  - coming back to the app after it was hidden for a few seconds -> the same.
 * `pull` is the height (px) of the little indicator while the finger is down. `enabled` is false where a reload would lose typed input.
 */
const THRESHOLD = 64;
const MAX_PULL = 90;
const AWAY_MS = 4_000;

export function useRefreshEpoch(enabled: boolean): { epoch: number; pull: number; refreshing: boolean } {
  const [epoch, setEpoch] = useState(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt = 0;
    const bump = () => {
      setRefreshing(true);
      setEpoch(e => e + 1);
      window.setTimeout(() => setRefreshing(false), 800);
    };
    const onVisible = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) bump();
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisible);

    let startY = 0;
    let tracking = false;
    let dist = 0;
    const atTop = (): boolean => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1 && atTop() && !document.querySelector('.sheet-back');
      if (tracking) { startY = e.touches[0]!.clientY; dist = 0; }
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy <= 0) { tracking = false; dist = 0; setPull(0); return; }
      dist = Math.min(dy * 0.5, MAX_PULL);
      setPull(dist);
    };
    const onEnd = () => {
      if (tracking && dist >= THRESHOLD) bump();
      tracking = false; dist = 0; setPull(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  return { epoch, pull, refreshing };
}
