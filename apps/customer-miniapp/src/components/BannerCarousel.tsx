import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/platform';
import type { Route } from '../lib/router';
import type { Banner } from '../lib/types';
import { PROMO_CATEGORY } from '../screens/Menu';
import { t } from '../i18n';

const SLIDE_MS = 4500;

/** Where a tap on a slide goes: the restaurant's menu, on its "Chegirmalar" group for an offer. A slide without a target is not clickable. */
export const bannerRoute = (b: Banner): Route | null =>
  b.target ? { name: 'menu', id: b.target.restaurantId, ...(b.target.promo ? { cat: PROMO_CATEGORY } : {}) } : null;

/**
 * News and offers above the restaurant search (owner decision 2026-11-01). Slides move by themselves every few seconds and by swipe; a touch pauses
 * the movement. Nothing is shown (no gap either) when there are no slides or they cannot be loaded: the search simply stays where it was.
 */
export function BannerCarousel({ go }: { go: (r: Route) => void }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    api.banners(ac.signal).then(r => setBanners(r.banners), () => { /* no slides: nothing to show */ });
    return () => ac.abort();
  }, []);

  const scrollTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    if (banners.length < 2) return;
    const t = window.setInterval(() => {
      if (paused.current || document.hidden) return;
      const el = track.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  return (
    <section className="banners" aria-label={t('Yangiliklar va chegirmalar')} aria-roledescription="carousel">
      <div className="banner-track" ref={track}
        onScroll={e => { const el = e.currentTarget; setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
        onTouchStart={() => { paused.current = true; }} onTouchEnd={() => { window.setTimeout(() => { paused.current = false; }, 6000); }}
        onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
        {banners.map((b, i) => {
          const route = bannerRoute(b);
          return (
            <div key={b.id} className={`banner-slide ${route ? 'tap' : ''}`} role={route ? 'button' : 'group'} tabIndex={route ? 0 : -1} aria-label={b.title} aria-roledescription="slide"
              onClick={() => { if (route) go(route); }} onKeyDown={e => { if (route && e.key === 'Enter') go(route); }}>
              <img src={mediaUrl(b.imageUrl, 1024) ?? ''} alt={b.title} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" draggable={false} referrerPolicy="no-referrer" />
            </div>
          );
        })}
      </div>
      {banners.length > 1 && (
        <div className="banner-dots" role="tablist" aria-label={t('Slaydlar')}>
          {banners.map((b, i) => <button key={b.id} role="tab" aria-selected={i === index} aria-label={t('{n}-slayd', { n: i + 1 })} className={i === index ? 'on' : ''} onClick={() => scrollTo(i)} />)}
        </div>
      )}
    </section>
  );
}
