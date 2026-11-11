import { ChevronDown, MapPin } from 'lucide-react';
import { Icon } from './ui';
import type { Route } from '../lib/router';
import { useApp } from '../state';
import { t } from '../i18n';

/** Home header: where the food will go (the default saved address). Tapping it opens the profile, where addresses are managed. Nothing without a saved address. */
export function AddressChip({ go }: { go: (r: Route) => void }) {
  const { profile } = useApp();
  const a = profile?.addresses.find(x => x.id === profile.defaultAddressId) ?? profile?.addresses.find(x => x.id === profile.lastUsedAddressId) ?? profile?.addresses[0];
  if (!a) return null;
  return (
    <button type="button" className="addr-chip" onClick={() => go({ name: 'profile' })}>
      <Icon as={MapPin} size={20} />
      <span className="addr-chip-text">
        <span className="addr-chip-lbl">{t('Yetkazish manzili')}</span>
        <span className="addr-chip-val">{a.label ? `${a.label} • ${a.addressText}` : a.addressText}</span>
      </span>
      <Icon as={ChevronDown} size={18} />
    </button>
  );
}
