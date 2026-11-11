/** `text` cut into three parts around the first match of `query` (case-insensitive), so the screen can mark the matched letters. No match: all in `before`. */
export function splitMatch(text: string, query: string): { before: string; match: string; after: string } {
  const q = query.trim();
  if (!q) return { before: text, match: '', after: '' };
  const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  // Lower-casing can change a text's length for a few scripts; then the positions would be wrong, so show it unmarked.
  if (at < 0 || text.toLocaleLowerCase().length !== text.length) return { before: text, match: '', after: '' };
  return { before: text.slice(0, at), match: text.slice(at, at + q.length), after: text.slice(at + q.length) };
}
