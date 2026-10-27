import { useEffect, useRef } from 'react';
import { FeeProgress } from './FeeProgress';
import { Button } from './ui';
import { cartBase, cartCount, cartTotal } from '../lib/cart';
import { FLAT_PRICING } from '../lib/fee';
import { som } from '../lib/format';
import { cartBarVisible, type Route } from '../lib/router';
import { useApp } from '../state';

/**
 * The way into the basket from any screen: pinned above the tab bar as soon as something is in the cart, with the discount progress bar on top.
 * It publishes its own height as --cartbar-h so the page above it keeps its last lines reachable.
 */
export function CartBar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const { cart } = useApp();
  const count = cartCount(cart);
  const visible = cartBarVisible(route, count);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) { root.style.removeProperty('--cartbar-h'); return; }
    const publish = () => root.style.setProperty('--cartbar-h', `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--cartbar-h');
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--cartbar-h'); };
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="cartfloat" ref={ref}>
      <FeeProgress base={cartBase(cart)} pricing={cart.pricing ?? FLAT_PRICING} />
      <Button onClick={() => go({ name: 'cart' })}>Savat • {count} ta • {som(cartTotal(cart))}</Button>
    </div>
  );
}
