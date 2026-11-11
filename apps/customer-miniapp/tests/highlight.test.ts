import { describe, expect, it } from 'vitest';
import { splitMatch } from '../src/lib/highlight';

describe('splitMatch', () => {
  it('marks the first match, ignoring case, and keeps the original letters', () => {
    expect(splitMatch('Lavash tovuqli', 'lav')).toEqual({ before: '', match: 'Lav', after: 'ash tovuqli' });
    expect(splitMatch('Sifat Food', 'FOO')).toEqual({ before: 'Sifat ', match: 'Foo', after: 'd' });
  });
  it('marks nothing when there is no match or no query', () => {
    expect(splitMatch('Osh', 'lav')).toEqual({ before: 'Osh', match: '', after: '' });
    expect(splitMatch('Osh', '  ')).toEqual({ before: 'Osh', match: '', after: '' });
  });
});
