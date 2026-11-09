/** Automatic address names ("Manzil 1", "Manzil 2", ...). Pure: no database. */

/** The first "Manzil N" (N starting at count + 1) that this customer does not already have. Comparison ignores case and surrounding spaces. */
export function nextAutoLabel(existing: readonly string[]): string {
  const taken = new Set(existing.map(l => l.trim().toLowerCase()));
  for (let n = existing.length + 1; ; n++) {
    const candidate = `Manzil ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
