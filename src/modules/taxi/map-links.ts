/** Map links for a delivery point, so a taxi operator opens the exact spot instead of reading raw coordinates. Pure: no I/O. */

const valid = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const fix = (n: number) => n.toFixed(6);

/** Yandex takes pt=<lng>,<lat> (longitude first); Google takes q=<lat>,<lng>. Returns null when the point is missing or out of range. */
export function mapLinks(lat: number | null | undefined, lng: number | null | undefined): { yandex: string; google: string } | null {
  if (!valid(lat, lng)) return null;
  const la = fix(lat);
  const lo = fix(lng as number);
  return {
    yandex: `https://yandex.com/maps/?pt=${lo},${la}&z=18&l=map`,
    google: `https://www.google.com/maps/search/?api=1&query=${la},${lo}`,
  };
}
