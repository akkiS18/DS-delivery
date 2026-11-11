import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Icon } from './ui';
import { t } from '../i18n';

/** A thin notice while the phone has no connection. The screens keep their last data and reload by themselves when it is back. */
export function OfflineBar() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return <div className="offbar" role="status"><Icon as={WifiOff} size={20} /><span>{t('Internet yo‘q. Ulangach o‘zi yangilanadi.')}</span></div>;
}
