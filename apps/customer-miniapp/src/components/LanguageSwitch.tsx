import { Languages } from 'lucide-react';
import { LANGS, setLang, t, useLang } from '../i18n';
import { haptic } from '../lib/telegram';
import { Icon } from './ui';

/** The customer's own language choice (kept on the phone). Until they pick one, the device language decides (i18n/index.ts). */
export function LanguageSwitch() {
  const lang = useLang();
  return (
    <section className="card stack" aria-label={t('Til')}>
      <h2 style={{ fontSize: 17 }} className="row"><Icon as={Languages} size={20} /> {t('Til')}</h2>
      <div className="chips wrap" role="group" aria-label={t('Til')}>
        {LANGS.map(l => (
          <button key={l.code} type="button" className={`chip ${lang === l.code ? 'on' : ''}`} aria-pressed={lang === l.code} lang={l.code}
            onClick={() => { haptic.tap(); setLang(l.code); }}>{l.label}</button>
        ))}
      </div>
    </section>
  );
}
