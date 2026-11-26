import { KeywordResult } from '../recordings/recording.types';

/** Lowercase, no punctuation, single spaces. Keeps Bangla vowel signs (ি ু ্) so words stay whole. */
const normalize = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The free check: is each keyword in the transcript? A keyword must start at a word boundary.
 * English may add a plural "s"/"es"; Bangla may add any ending (বিকাশে, বিকাশের still count as বিকাশ).
 */
export function findKeywords(keywords: string[], transcript: string): KeywordResult[] {
  const text = ` ${normalize(transcript)} `;
  return keywords.map((keyword) => {
    const k = normalize(keyword);
    if (!k) return { keyword, said: false, how: 'exact' };
    const bangla = /\p{Script=Bengali}$/u.test(k);
    const ending = bangla ? '' : '(?:s|es)?(?= )';
    return { keyword, said: new RegExp(` ${escape(k)}${ending}`, 'u').test(text), how: 'exact' };
  });
}
