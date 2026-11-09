/** HTTP Range header (one range only) for serving the offline map file. Pure: no I/O. */
export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }   // both inclusive
  | { kind: 'unsatisfiable' };

/**
 * bytes=a-b, bytes=a- and bytes=-n. No header, another unit, several ranges or garbage: the whole file (a server may ignore a Range it does not
 * understand). A start beyond the end of the file: unsatisfiable (416).
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  let start: number; let end: number;
  if (m[1] === '') {                       // suffix: the last n bytes
    const n = Number(m[2]);
    if (n === 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size) return { kind: 'unsatisfiable' };
    if (end < start) return { kind: 'full' };   // a malformed pair (5-2) is ignored, per RFC 9110
  }
  return { kind: 'partial', start, end };
}
