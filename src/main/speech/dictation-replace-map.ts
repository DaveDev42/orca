import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPLACE_FILE = 'dictation-replace.tsv'

// A key matches only at a word end: end of text, a non-Hangul character, or one of these
// Korean particles/endings followed by end or non-Hangul.
const PARTICLES = [
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '에서',
  '에게',
  '로',
  '으로',
  '와',
  '과',
  '도',
  '만',
  '의',
  '랑',
  '이랑',
  '하고',
  '까지',
  '부터',
  '처럼',
  '보다',
  '이나',
  '나',
  '이고',
  '이다',
  '입니다',
  '이에요',
  '예요',
  '야',
  '요',
  '에는',
  '으로는',
  '로는',
  '에도',
  '만큼',
  '마다',
  '밖에',
  '이랑은',
  '에서는',
  '에서도',
  '에게는',
  '에게도',
  '으로도',
  '로도',
  '라고',
  '이라고',
  '이랑도'
]
const PARTICLE_ALTERNATION = [...PARTICLES]
  .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  .join('|')

type Rule = [pattern: RegExp, written: string]

export function parseReplaceMap(tsv: string): Rule[] {
  return tsv
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((cols): cols is [string, string] => cols.length === 2 && !!cols[0] && !!cols[1])
    .sort((a, b) => b[0].length - a[0].length)
    .map(([spoken, written]): Rule => [
      new RegExp(
        `(^|[^가-힣])${spoken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^가-힣]|(?:${PARTICLE_ALTERNATION})(?:$|[^가-힣]))`,
        'g'
      ),
      written
    ])
}

export function applyReplaceMap(text: string, rules: readonly Rule[]): string {
  let out = text
  for (const [pattern, written] of rules) {
    out = out.replace(pattern, (_match, prefix: string) => prefix + written)
  }
  return out
}

let cache: { path: string; mtimeMs: number; rules: Rule[] } | null = null
let lastCheckAt = 0
const RECHECK_MS = 3000

async function refreshRules(path: string): Promise<void> {
  try {
    const { mtimeMs } = await stat(path)
    if (cache?.path !== path || cache.mtimeMs !== mtimeMs) {
      cache = { path, mtimeMs, rules: parseReplaceMap(await readFile(path, 'utf8')) }
    }
  } catch {
    cache = null
  }
}

function currentRules(path: string): Rule[] {
  const now = Date.now()
  if (cache?.path !== path || now - lastCheckAt > RECHECK_MS) {
    lastCheckAt = now
    void refreshRules(path)
  }
  return cache?.path === path ? cache.rules : []
}

/**
 * Applies `~/.orca/dictation-replace.tsv` (`spoken Hangul<TAB>written`) so a term written in Latin
 * comes back in Latin. Wraps the transcript pipeline for mobile dictation; a missing file is a no-op.
 * Main-process reads stay async: the map loads in the background and edits apply within seconds.
 */
export function withReplaceMap(
  clean: ((text: string) => string) | null,
  path = join(homedir(), '.orca', REPLACE_FILE)
): (text: string) => string {
  void refreshRules(path)
  return (text) => applyReplaceMap(clean ? clean(text) : text, currentRules(path))
}
