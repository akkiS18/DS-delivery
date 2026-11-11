import { useSyncExternalStore } from 'react';
import { Moon, Smartphone, Sun, type LucideIcon } from 'lucide-react';
import { setThemePref, subscribeTheme, themePrefSnapshot, type ThemePref } from '../lib/theme';
import { haptic } from '../lib/telegram';
import { t } from '../i18n';
import { Icon } from './ui';

/** Light / dark / follow the phone. The choice is kept on the phone (lib/theme.ts). */
export function ThemeSwitch() {
  const pref = useSyncExternalStore(subscribeTheme, themePrefSnapshot, themePrefSnapshot);
  const options: Array<{ value: ThemePref; icon: LucideIcon; label: string }> = [
    { value: 'auto', icon: Smartphone, label: t('Avto') },
    { value: 'light', icon: Sun, label: t('Kunduzgi') },
    { value: 'dark', icon: Moon, label: t('Tungi') },
  ];
  return (
    <div className="themeseg" role="radiogroup" aria-label={t('Ko‘rinish')}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={pref === o.value} className={pref === o.value ? 'on' : ''}
          onClick={() => { haptic.tap(); setThemePref(o.value); }}>
          <Icon as={o.icon} size={18} />{o.label}
        </button>
      ))}
    </div>
  );
}
