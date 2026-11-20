import { getLegacySearchBindings } from '../../../src/shared/keybindings/definitions'
import { useForkTranslation } from '../fork-i18n/use-fork-translation'
import type { Section, Worktree } from '../worktree/workspace-list/workspace-list-types'
import { usePageKeyCommands } from './use-page-key-commands'

/** The workspaces the list shows, top to bottom: what the desktop's Cmd+digit counts, whatever the grouping. */
export function visibleWorkspaceRows(
  sections: readonly Pick<Section, 'data'>[]
): readonly Worktree[] {
  return sections.flatMap((section) => section.data.map((item) => item.row))
}

// Cmd+J is the desktop's jump palette in its legacy keymap; the phone's counterpart is the list's search field.
const JUMP_BINDINGS = getLegacySearchBindings('darwin')['worktree.palette'] ?? []

/**
 * The workspace list's chords while it is on screen: Cmd+1-9 open the Nth workspace shown, and
 * Cmd+J puts the cursor in the list's search field. Claimed by the list, so a session that is not
 * showing it (the phone, one screen deep) leaves both to the system.
 */
export function useHostKeyCommands(
  active: boolean,
  sections: readonly Pick<Section, 'data'>[],
  openWorkspace: (workspace: Worktree) => void,
  focusSearch: () => void
): void {
  const t = useForkTranslation()
  usePageKeyCommands(active, 'app', [
    {
      actionId: 'workspace.selectByIndex',
      title: (digit: number) =>
        t('hostScreen.keyCommands.openWorkspace', 'Workspace {{n}}', { n: digit }),
      onDigit: (digit: number) => {
        const target = visibleWorkspaceRows(sections)[digit - 1]
        if (target) {
          openWorkspace(target)
        }
      }
    },
    {
      actionId: 'worktree.palette',
      title: t('hostScreen.keyCommands.searchWorkspaces', 'Search Workspaces'),
      bindings: JUMP_BINDINGS,
      run: focusSearch
    }
  ])
}
