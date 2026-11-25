import { DiffChunk } from '../recordings/recording.types';

/**
 * Word-by-word comparison of the script with what was spoken.
 * Works for English and Bangla (keeps letters, numbers and combining marks
 * like ি ু ্ so Bangla words aren't broken apart).
 */

interface Token {
  raw: string; // as written, for display
  norm: string; // lowercase, punctuation removed, for comparing
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .map((raw) => ({
      raw,
      norm: raw
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}']/gu, '')
        .replace(/^'+|'+$/g, ''),
    }))
    .filter((t) => t.norm.length > 0);
}

export interface DiffResult {
  chunks: DiffChunk[];
  scriptWords: number;
  spokenWords: number;
  matched: number;
  missing: number;
  extra: number;
  changed: number;
  /** matched / scriptWords, 0-100 */
  accuracy: number;
}

const MAX_WORDS = 4000;

export function compareTexts(script: string, spoken: string): DiffResult {
  const a = tokenize(script).slice(0, MAX_WORDS);
  const b = tokenize(spoken).slice(0, MAX_WORDS);
  const n = a.length;
  const m = b.length;

  // Longest common subsequence table (lengths of suffixes)
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i].norm === b[j].norm
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  // Walk the table to produce one op per word
  type Op = { type: 'match' | 'missing' | 'extra'; word: string; spoken?: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].norm === b[j].norm) {
      ops.push({ type: 'match', word: a[i].raw, spoken: b[j].raw });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: 'missing', word: a[i++].raw });
    } else {
      ops.push({ type: 'extra', word: b[j++].raw });
    }
  }
  while (i < n) ops.push({ type: 'missing', word: a[i++].raw });
  while (j < m) ops.push({ type: 'extra', word: b[j++].raw });

  // Group consecutive ops; a "missing" run right next to an "extra" run = a changed phrase
  const chunks: DiffChunk[] = [];
  let k = 0;
  let matched = 0;
  let missing = 0;
  let extra = 0;
  let changed = 0;
  while (k < ops.length) {
    if (ops[k].type === 'match') {
      const words: string[] = [];
      while (k < ops.length && ops[k].type === 'match') words.push(ops[k++].word);
      matched += words.length;
      chunks.push({ type: 'match', expected: words.join(' '), spoken: words.join(' ') });
      continue;
    }
    const miss: string[] = [];
    const ext: string[] = [];
    while (k < ops.length && ops[k].type !== 'match') {
      if (ops[k].type === 'missing') miss.push(ops[k].word);
      else ext.push(ops[k].word);
      k++;
    }
    if (miss.length && ext.length) {
      changed += miss.length;
      chunks.push({ type: 'changed', expected: miss.join(' '), spoken: ext.join(' ') });
    } else if (miss.length) {
      missing += miss.length;
      chunks.push({ type: 'missing', expected: miss.join(' ') });
    } else {
      extra += ext.length;
      chunks.push({ type: 'extra', spoken: ext.join(' ') });
    }
  }

  return {
    chunks,
    scriptWords: n,
    spokenWords: m,
    matched,
    missing,
    extra,
    changed,
    accuracy: n === 0 ? 0 : Math.round((matched / n) * 1000) / 10,
  };
}
