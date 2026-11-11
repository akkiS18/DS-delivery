import { useCallback, useState } from 'react';
import { api } from './api';
import { catalogAction } from './cart';
import { planReorder } from './reorder';
import { confirmDialog } from './telegram';
import type { Route } from './router';
import type { OrderSummary } from './types';
import { useApp } from '../state';
import { t } from '../i18n';

/** "Yana buyurtma berish": puts the dishes of a past order that are still on the menu into the basket and opens it. Prices come from today's menu. */
export function useReorder(go: (r: Route) => void) {
  const { cart, dispatch, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null); // id of the order being put together
  const reorder = useCallback(async (o: OrderSummary) => {
    if (busy || !o.restaurantId || !o.reorder || o.reorder.length === 0) return;
    setBusy(o.id);
    try {
      const menu = await api.menu(o.restaurantId);
      if (!menu.restaurant.isOpen) { toast(t('Restoran hozir yopiq')); go({ name: 'menu', id: o.restaurantId }); return; }
      const plan = planReorder(menu, o.reorder);
      if (plan.adds.length === 0) { toast(t('Bu taomlar endi menyuda yo‘q')); go({ name: 'menu', id: o.restaurantId }); return; }
      if (cart.restaurantId && cart.restaurantId !== menu.restaurant.id && cart.lines.length > 0) {
        if (!(await confirmDialog(t('Savatda boshqa restorandan mahsulotlar bor. Savatni tozalab, bu restorandan boshlaymizmi?')))) return;
      }
      if (menu.pricing) dispatch({ type: 'pricing', pricing: menu.pricing });
      for (const { product, quantity } of plan.adds) {
        for (let i = 0; i < quantity; i++) {
          dispatch({ type: 'add', restaurantId: menu.restaurant.id, restaurantName: menu.restaurant.name, product: { id: product.id, name: product.name, priceSom: product.priceSom, packaging: product.packaging ?? null, description: product.description, oldPriceSom: product.oldPriceSom ?? null } });
        }
      }
      dispatch(catalogAction(menu));
      if (plan.missing > 0) toast(t('{n} ta taom endi menyuda yo‘q', { n: plan.missing }));
      go({ name: 'cart' });
    } catch {
      toast(t('Menyuni yuklab bo‘lmadi. Qayta urinib ko‘ring'));
    } finally { setBusy(null); }
  }, [busy, cart, dispatch, go, toast]);
  return { reorder, busy };
}
