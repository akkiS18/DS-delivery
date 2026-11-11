import { LANGS, setLang, t, useLang } from '../i18n';
import { haptic } from '../lib/telegram';

/** The customer's own language choice (kept on the phone). Until they pick one, the device language decides (i18n/index.ts). Sits on the green profile header. */
export function LanguageSwitch() {
  const lang = useLang();
  return (
    <div className="langseg" role="radiogroup" aria-label={t('Til')}>
      {LANGS.map(l => (
        <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} className={lang === l.code ? 'on' : ''} lang={l.code}
          onClick={() => { haptic.tap(); setLang(l.code); }}>{l.label}</button>
      ))}
    </div>
  );
}
