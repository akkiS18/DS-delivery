import { useState } from 'react';
import { apiOrigin, sizedUrl } from '../lib/platform';
import { initials, nameHue } from '../lib/rating';

/**
 * The restaurant's photo or logo, filling its whole frame (no blurred copy behind it, no empty bands). A picture smaller than the frame is
 * scaled up to cover it, with a little extra (CSS .rphoto-img) so a thin white edge of a logo never shows at the border.
 * No photo / it failed to load: a coloured tile with the restaurant's initials, so a card never looks broken.
 * `slot="cover"` (menu header background) asks the server for the restaurant's wide background picture; other frames get its logo when it
 * has one (src/modules/restaurant/image.ts pickPicture).
 */
export function RestaurantPhoto({ name, url, className = '', width = 640, slot }: { name: string; url: string | null | undefined; className?: string; width?: number; slot?: 'cover' }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const hue = nameHue(name);
    return (
      <div className={`rphoto-empty ${className}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 40) % 360} 60% 55%))` }} aria-hidden>
        <span>{initials(name)}</span>
      </div>
    );
  }
  return <img className={`rphoto-img ${className}`} src={`${apiOrigin()}${sizedUrl(url, width)}${slot ? `&slot=${slot}` : ''}`} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
