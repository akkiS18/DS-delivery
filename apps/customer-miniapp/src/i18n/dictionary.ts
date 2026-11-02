export { RU } from './ru';

/**
 * Words whose generated Cyrillic spelling (translit.ts) is not what a native reader expects. Key = the Uzbek Latin text, value = the Cyrillic
 * text. Empty until a native reader has reviewed the generated texts; add a line here instead of changing the rule for one word.
 */
export const UZ_CYRL_OVERRIDES: Record<string, string> = {};
