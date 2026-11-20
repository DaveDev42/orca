import { describe, expect, it } from 'vitest'
import type { Worktree } from '../worktree/workspace-list/workspace-list-types'
import { visibleWorkspaceRows } from './use-host-key-commands'

function row(worktreeId: string): { row: Worktree } {
  return { row: { worktreeId } as Worktree }
}

describe('visibleWorkspaceRows', () => {
  it('lists rows top to bottom across sections, so Cmd+N counts what the list shows', () => {
    const rows = visibleWorkspaceRows([
      { data: [row('a'), row('b')] },
      { data: [] },
      { data: [row('c')] }
    ] as never)
    expect(rows.map((item) => item.worktreeId)).toEqual(['a', 'b', 'c'])
  })

  it('is empty for no sections', () => {
    expect(visibleWorkspaceRows([])).toEqual([])
  })
})
