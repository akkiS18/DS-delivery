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

/** Keyboard drop that counts as "open": a real keyboard takes far more than this; browser toolbars take less. */
export const KEYBOARD_MIN_DROP = 120;

/**
 * Is the soft keyboard open? Needs BOTH a text field in focus AND the visible height clearly below the tallest height seen (`baseline`).
 * Height alone would misfire on a split-screen resize; focus alone would stick when the keyboard is closed with the back key while the field
 * keeps focus. Requiring both means the bar can only be hidden while the keyboard really occupies the screen, and returns the moment it does not.
 */
export function keyboardOpen(baseline: number, visible: number, editableFocused: boolean): boolean {
  if (!editableFocused || !Number.isFinite(baseline) || !Number.isFinite(visible) || visible <= 0) return false;
  return baseline - visible >= KEYBOARD_MIN_DROP && visible < baseline * 0.85;
}

const EDITABLE = 'input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=range]):not([type=file]), textarea, [contenteditable=""], [contenteditable="true"]';
function editableFocused(): boolean {
  const el = document.activeElement;
  return !!el && el !== document.body && el.matches(EDITABLE);
}

/** Publishes --kb-offset, data-nav and data-kb on <html>; every screen inherits the behaviour through CSS, none handles the keyboard itself. */
export function useViewportLayout(): void {
  useEffect(() => {
    const root = document.documentElement;
    let baseline = 0;
    // Safety net: while the bar is hidden, re-check every second, so a missed resize event can never leave it hidden.
    let watchdog: number | undefined;
    const apply = () => {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      const focused = editableFocused();
      // Tallest visible height seen. While no field is focused the keyboard cannot be open, so the current height is the truth (also after a rotation).
      baseline = focused ? Math.max(baseline, h) : h;
      if (keyboardOpen(baseline, h, focused)) {
        root.dataset.kb = 'open';
        if (watchdog === undefined) watchdog = window.setInterval(apply, 1000);
      } else {
        delete root.dataset.kb;
        if (watchdog !== undefined) { window.clearInterval(watchdog); watchdog = undefined; }
      }
      const off = vv ? keyboardOffset(window.innerHeight, vv.height, vv.offsetTop) : 0;
      // Mode from the height that is really visible above any overlaid keyboard.
      root.dataset.nav = navMode(h);
      root.style.setProperty('--kb-offset', `${off}px`);
    };
    apply();
    const vv = window.visualViewport;
    // A field gaining or losing focus re-evaluates immediately; the delayed pass catches a keyboard that finishes its animation later.
    const later = () => { apply(); window.setTimeout(apply, 350); };
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', later);
    document.addEventListener('visibilitychange', apply);
    window.addEventListener('pageshow', apply);
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    const offTg = onTelegramViewport(apply);
    return () => {
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', later);
      document.removeEventListener('visibilitychange', apply);
      window.removeEventListener('pageshow', apply);
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      offTg();
      delete root.dataset.nav;
      delete root.dataset.kb;
      if (watchdog !== undefined) window.clearInterval(watchdog);
      root.style.removeProperty('--kb-offset');
    };
  }, []);
}
