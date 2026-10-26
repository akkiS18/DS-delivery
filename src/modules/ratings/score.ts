/**
 * Restaurant rating maths. Two different numbers on purpose:
 *   - the DISPLAYED average is the honest plain mean of every rating, shown with the count, and hidden until minPublic ratings exist;
 *   - the RANKING score is a Bayesian ("trusted") average with a slow time decay, so one lucky 5-star rating cannot put a new restaurant above
 *     one that earned 4.8 over hundreds of orders, and a restaurant that improves (or gets worse) is judged mostly on recent orders:
 *         score = (C * m + sum(w_i * stars_i)) / (C + sum(w_i)),   w_i = 0.5 ^ (ageDays_i / halfLifeDays)
 *     m = prior mean (what an unknown restaurant is assumed to be), C = how many ratings' worth of doubt the prior carries.
 */
export interface RatingConfig { priorMean: number; priorWeight: number; halfLifeDays: number; minPublic: number }

export const ratingConfig = (env: NodeJS.ProcessEnv = process.env): RatingConfig => {
  const num = (v: string | undefined, d: number, lo: number, hi: number): number => {
    const n = v === undefined || v.trim() === '' ? d : Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error('RATING_SOZLAMA_NOTOGRI');
    return n;
  };
  return {
    priorMean: num(env.RATING_PRIOR_MEAN, 4.3, 1, 5),
    priorWeight: num(env.RATING_PRIOR_WEIGHT, 10, 0, 1000),
    halfLifeDays: num(env.RATING_HALF_LIFE_DAYS, 90, 1, 3650),
    minPublic: Math.trunc(num(env.RATING_MIN_PUBLIC, 5, 1, 1000)),
  };
};

export interface RatingSample { stars: number; createdAt: Date }
const DAY_MS = 86_400_000;

/** Plain mean rounded to one decimal, or null when fewer than `minPublic` people rated (the public card shows nothing yet). */
export function publicRating(sum: number, count: number, cfg: RatingConfig = ratingConfig()): { avg: number; count: number } | null {
  if (count < cfg.minPublic || count <= 0) return null;
  return { avg: Math.round((sum / count) * 10) / 10, count };
}

/** The ranking score (higher = better). Always defined: an unrated restaurant scores exactly the prior mean. */
export function rankingScore(samples: readonly RatingSample[], now: Date, cfg: RatingConfig = ratingConfig()): number {
  let weighted = 0;
  let weights = 0;
  for (const s of samples) {
    const ageDays = Math.max(0, (now.getTime() - s.createdAt.getTime()) / DAY_MS);
    const w = 0.5 ** (ageDays / cfg.halfLifeDays);
    weighted += w * s.stars;
    weights += w;
  }
  return (cfg.priorWeight * cfg.priorMean + weighted) / (cfg.priorWeight + weights);
}
