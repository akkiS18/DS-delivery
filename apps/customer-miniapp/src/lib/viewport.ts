import { useEffect } from 'react';
import { onTelegramViewport } from './telegram';

/**
 * How much room the tab bar gets. Decided from the *visible* height only (not from focus), so it works for any keyboard, a landscape phone
 * or a split-screen window:
 *  - full:    labelled tab bar (normal)
 *  - compact: icon-only, shorter bar (keyboard open on a normal phone)
 *  - inline:  not fixed at all; the bar sits at the end of the page and is reached by scrolling (almost no visible height left)
 */
export type NavMode = 'full' | 'compact' | 'inline';
export const FULL_MIN = 460;
export const COMPACT_MIN = 300;

export function navMode(visibleHeight: number): NavMode {
  if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) return 'full';
  return visibleHeight >= FULL_MIN ? 'full' : visibleHeight >= COMPACT_MIN ? 'compact' : 'inline';
}

/**
 * Distance the fixed bar must be lifted so it sits above the keyboard. Non-zero only for browsers that overlay the keyboard instead of
 * resizing the layout viewport (iOS Safari, some Android Chrome). Telegram resizes the WebView, so it is 0 there.
 */
export function keyboardOffset(layoutHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const off = layoutHeight - vvHeight - vvOffsetTop;
  return Number.isFinite(off) && off > 80 ? Math.round(off) : 0;
}

/** Publishes --kb-offset and data-nav on <html>; every screen inherits the behaviour through CSS, none handles the keyboard itself. */
export function useViewportLayout(): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      const off = vv ? keyboardOffset(window.innerHeight, vv.height, vv.offsetTop) : 0;
      // Mode from the height that is really visible above any overlaid keyboard.
      root.dataset.nav = navMode(h);
      root.style.setProperty('--kb-offset', `${off}px`);
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    const offTg = onTelegramViewport(apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      offTg();
      delete root.dataset.nav;
      root.style.removeProperty('--kb-offset');
    };
  }, []);
}
