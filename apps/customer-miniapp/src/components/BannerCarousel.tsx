import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/platform';
import type { Route } from '../lib/router';
import type { Banner } from '../lib/types';
import { PROMO_CATEGORY } from '../screens/Menu';
import { t } from '../i18n';

const SLIDE_MS = 4500;
const SLIDE_GAP = 10; // keep equal to .banner-track gap in styles.css

/**
 * Where a tap on a slide goes: the restaurant's menu, on its "Chegirmalar" group for a 1+1 offer, on its "AKSIYA" group when the server names one
 * (`categoryId`). A slide without a target is not clickable.
 */
export const bannerRoute = (b: Banner): Route | null =>
  b.target ? { name: 'menu', id: b.target.restaurantId, ...(b.target.promo ? { cat: PROMO_CATEGORY } : b.target.categoryId ? { cat: b.target.categoryId } : {}) } : null;

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

  /** One slide's pitch: the slide is narrower than the track (the next one peeks in), so a step is slide width + gap. */
  const pitch = (el: HTMLElement) => {
    const first = el.firstElementChild as HTMLElement | null;
    return Math.max(1, (first?.offsetWidth ?? el.clientWidth) + SLIDE_GAP);
  };
  const scrollTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * pitch(el), behavior: 'smooth' });
  };

  useEffect(() => {
    if (banners.length < 2) return;
    const t = window.setInterval(() => {
      if (paused.current || document.hidden) return;
      const el = track.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / pitch(el)) + 1) % banners.length;
      el.scrollTo({ left: next * pitch(el), behavior: 'smooth' });
    }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  return (
    <section className="banners" aria-label={t('Yangiliklar va chegirmalar')} aria-roledescription="carousel">
      <div className="banner-track" ref={track}
        onScroll={e => { const el = e.currentTarget; setIndex(Math.round(el.scrollLeft / pitch(el))); }}
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
