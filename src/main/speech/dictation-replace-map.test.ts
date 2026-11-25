import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyReplaceMap, parseReplaceMap, withReplaceMap } from './dictation-replace-map'

describe('dictation replace map', () => {
  const rules = parseReplaceMap('깃허브\tGitHub\n클로드 코드\tClaude Code\n')

  it('replaces a term followed by a Korean particle but not one inside a longer word', () => {
    expect(applyReplaceMap('깃허브에서 봤어', rules)).toBe('GitHub에서 봤어')
    expect(applyReplaceMap('깃허브', rules)).toBe('GitHub')
    expect(applyReplaceMap('깃허브스러운', rules)).toBe('깃허브스러운')
  })

  it('prefers the longer spoken key and escapes regex characters', () => {
    expect(applyReplaceMap('클로드 코드를 켜', rules)).toBe('Claude Code를 켜')
    const dotted = parseReplaceMap('점.티\tdot.t\n')
    expect(applyReplaceMap('점.티 그리고 점x티', dotted)).toBe('dot.t 그리고 점x티')
  })

  it('reads the file named by the caller and is a no-op when it is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-replace-'))
    const path = join(dir, 'dictation-replace.tsv')
    expect(withReplaceMap(null, path)('깃허브')).toBe('깃허브')
    writeFileSync(path, '깃허브\tGitHub\n')
    const replace = withReplaceMap((t) => t.trim(), path)
    await vi.waitFor(() => expect(replace(' 깃허브 ')).toBe('GitHub'))
  })
})
