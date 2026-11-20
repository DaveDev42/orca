import { describe, expect, it } from 'vitest'
import type { Worktree } from '../worktree/workspace-list/workspace-list-types'
import { visibleWorkspaceRows } from './use-host-key-commands'

function row(worktreeId: string): { row: Worktree } {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test reads only worktreeId.
  return { row: { worktreeId } as Worktree }
}

describe('visibleWorkspaceRows', () => {
  it('lists rows top to bottom across sections, so Cmd+N counts what the list shows', () => {
    const sections = [{ data: [row('a'), row('b')] }, { data: [] }, { data: [row('c')] }]
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test sections carry only the fields visibleWorkspaceRows reads.
    const rows = visibleWorkspaceRows(sections as never)
    expect(rows.map((item) => item.worktreeId)).toEqual(['a', 'b', 'c'])
  })

  it('is empty for no sections', () => {
    expect(visibleWorkspaceRows([])).toEqual([])
  })
})
