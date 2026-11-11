import { useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import { CartBar } from './components/CartBar';
import { OfflineBar } from './components/OfflineBar';
import { Button, ErrorBox, Icon, Skeletons, TabBar } from './components/ui';
import { isTab, parentOf, type Route } from './lib/router';
import { useViewportLayout } from './lib/viewport';
import { isAndroidApp } from './lib/platform';
import { insideTelegram, setBackButton } from './lib/telegram';
import { Cart } from './screens/Cart';
import { Checkout } from './screens/Checkout';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Menu } from './screens/Menu';
import { OrderScreen } from './screens/Order';
import { Reserve } from './screens/Reserve';
import { ReservationScreen } from './screens/Reservation';
import { Reservations } from './screens/Reservations';
import { Orders } from './screens/Orders';
import { Profile } from './screens/Profile';
import { Support } from './screens/Support';
import { SupportNew } from './screens/SupportNew';
import { Ticket } from './screens/Ticket';
import { useSupportUnread } from './lib/support';
import { useRefreshEpoch } from './lib/refresh';
import { useApp, useRoute } from './state';
import { t, useLang } from './i18n';

export function App() {
  const { status, error, reload } = useApp();
  const lang = useLang(); // a language change re-renders the whole screen tree (the key below remounts <main>)
  const [route, go] = useRoute();
  useViewportLayout();
  const supportUnread = useSupportUnread(route.name === 'ticket' ? 'ticket' : route.name);
  // Pull down / coming back to the app reloads the current screen (not the checkout or reservation form: typed input must survive).
  const { epoch, pull, refreshing } = useRefreshEpoch(route.name !== 'checkout' && route.name !== 'reserve');

  // Telegram's native back button follows an explicit parent map so it never leaves the app or loops.
  useEffect(() => {
    const parent = parentOf(route);
    return setBackButton(parent !== null, () => { if (parent) go(parent, { replace: true }); });
  }, [route, go]);

  if (status === 'loading') return <div className="page"><Skeletons n={3} /></div>;
  if (status === 'error') {
    // The "open in Telegram" block is for the web/Mini App build only; the Android app signs in as a guest.
    const noTelegram = !isAndroidApp && (error?.code === 'NO_TELEGRAM' || !insideTelegram());
    return (
      <div className="page">
        {error?.status === 401 && noTelegram
          ? <div className="openintg"><div className="big" aria-hidden><Icon as={Smartphone} size={44} /></div><h2>{t('Telegram orqali oching')}</h2><p>{t('Bu ilova faqat Telegram ichida ishlaydi. Botdagi “Buyurtma berish” tugmasini bosing.')}</p></div>
          : <ErrorBox error={error} onRetry={reload} />}
        {error?.status !== 401 && <Button variant="ghost" onClick={reload}>{t('Qayta yuklash')}</Button>}
      </div>
    );
  }
  return (
    <div className="app">
      {(pull > 0 || refreshing) && <div className="ptr" style={{ height: refreshing ? 52 : pull }} aria-hidden><div><span className="spinner" style={{ width: 18, height: 18, margin: 0, borderWidth: 2, animationPlayState: refreshing || pull >= 60 ? 'running' : 'paused' }} /></div></div>}
      <OfflineBar />
      <main className="app-main" key={`${route.name}:${'id' in route ? route.id : ''}:${epoch}:${lang}`}>{screen(route, go)}</main>
      <CartBar route={route} go={go} />
      <TabBar route={route} go={r => go(r)} orders={0} support={supportUnread} />
    </div>
  );
}

function screen(route: Route, go: (r: Route, o?: { replace?: boolean }) => void) {
  switch (route.name) {
    case 'home': return <Home go={go} />;
    case 'menu': return <Menu id={route.id} {...(route.cat ? { cat: route.cat } : {})} go={go} />;
    case 'cart': return <Cart go={go} />;
    case 'checkout': return <Checkout go={go} />;
    case 'order': return <OrderScreen id={route.id} go={go} />;
    case 'orders': return <Orders go={go} />;
    case 'history': return <History go={go} />;
    case 'reserve': return <Reserve id={route.id} go={go} />;
    case 'reservation': return <ReservationScreen id={route.id} go={go} />;
    case 'reservations': return <Reservations go={go} />;
    case 'profile': return <Profile go={go} />;
    case 'support': return <Support go={go} />;
    case 'ticket': return <Ticket id={route.id} go={go} />;
    case 'supportNew': return <SupportNew orderId={route.orderId} go={go} />;
  }
}

export { isTab };
