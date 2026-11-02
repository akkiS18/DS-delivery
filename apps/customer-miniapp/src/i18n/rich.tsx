import { Fragment, type ReactNode } from 'react';
import { getLang, translate } from './index';

/**
 * A translated text that contains a little markup or React parts. The Uzbek text is the key, as with t(); inside it
 *   <b>bold</b>  and  {name}  (replaced by params[name], which may be a string, a number or a React element).
 * The word order of a language can differ from Uzbek, so the markup lives inside the text, not around it:
 *   rich('Yana <b>{sum}</b> qo‘shing', { sum: som(5000) })
 * Params are inserted after the text is split, so a param can never turn into markup.
 */
export function rich(key: string, params: Record<string, ReactNode> = {}): ReactNode {
  return <>{parts(translate(getLang(), key), params)}</>;
}

function parts(text: string, params: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<b>(.*?)<\/b>|\{(\w+)\}/g;
  let last = 0;
  let n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={n++}>{parts(m[1], params)}</b>);
    else { const v = params[m[2]!]; out.push(<Fragment key={n++}>{v !== undefined ? v : m[0]}</Fragment>); }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
