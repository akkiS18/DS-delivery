import { useState } from 'react';
import { apiOrigin, sizedUrl } from '../lib/platform';
import { initials, nameHue } from '../lib/rating';

/** The restaurant's photo, or (no photo / it failed to load) a coloured tile with its initials, so a card never looks broken. */
/**
 * `whole`: the picture is shown complete (a logo must not lose its edges to the frame), the rest of the frame is filled with a blurred copy of it.
 * Without it the picture fills the frame and is cropped (category tiles, where a photo is wanted edge to edge).
 */
export function RestaurantPhoto({ name, url, className = '', width = 640, whole = false }: { name: string; url: string | null | undefined; className?: string; width?: number; whole?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    const hue = nameHue(name);
    return (
      <div className={`rphoto-empty ${className}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 40) % 360} 60% 55%))` }} aria-hidden>
        <span>{initials(name)}</span>
      </div>
    );
  }
  const src = `${apiOrigin()}${sizedUrl(url, width)}`;
  if (!whole) return <img className={`rphoto-img ${className}`} src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return (
    <>
      <img className="rphoto-bg" src={src} alt="" aria-hidden loading="lazy" decoding="async" />
      <img className={`rphoto-img rphoto-whole ${className}`} src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </>
  );
}
