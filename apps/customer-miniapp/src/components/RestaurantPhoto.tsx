import { useState } from 'react';
import { apiOrigin } from '../lib/platform';
import { initials, nameHue } from '../lib/rating';

/** The restaurant's photo, or (no photo / it failed to load) a coloured tile with its initials, so a card never looks broken. */
export function RestaurantPhoto({ name, url, className = '' }: { name: string; url: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const hue = nameHue(name);
    return (
      <div className={`rphoto-empty ${className}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 40) % 360} 60% 55%))` }} aria-hidden>
        <span>{initials(name)}</span>
      </div>
    );
  }
  return <img className={`rphoto-img ${className}`} src={`${apiOrigin()}${url}`} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
