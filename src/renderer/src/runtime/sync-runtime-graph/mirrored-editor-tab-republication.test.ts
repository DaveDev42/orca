import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeState as makePublicationState } from '../sync-runtime-graph-test-harness'
import { applyWebSessionTabsSnapshot } from '../web-session-tabs-sync/snapshot-api'
import {
  ENV,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from '../web-session-tabs-sync-test-harness'
import { buildMobileSessionTabSnapshots } from './mobile-session-snapshots'
import { getRuntimeMobileSessionSyncKey, runtimeMobileSessionSyncKeysEqual } from './sync-key'
import type { RuntimeMobileSessionFileTab } from '../../../../shared/runtime-types'

vi.mock('../../store', () => ({ useAppStore: { setState: vi.fn() } }))

describe('mirrored editor tab republication', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  function mirrorHostTab(tab: RuntimeMobileSessionFileTab) {
    const state = makeState()
    const patch = applyWebSessionTabsSnapshot(state, makeSnapshot([tab]), ENV, NOW)
    return makePublicationState({ ...state, ...patch })
  }

  const fileTab: RuntimeMobileSessionFileTab = {
    type: 'file',
    id: 'host-file-tab',
    title: 'app.ts',
    filePath: '/repo/app.ts',
    relativePath: 'app.ts',
    language: 'typescript',
    mode: 'edit',
    isDirty: false,
    isActive: true
  }

  it('keeps a genuinely local file in the same worktree and retracts it after close', () => {
    const mirroredState = mirrorHostTab(fileTab)
    const clientState = {
      ...mirroredState,
      openFiles: [
        ...mirroredState.openFiles,
        {
          id: 'local-file',
          filePath: '/repo/local.ts',
          relativePath: 'local.ts',
          worktreeId: WT,
          language: 'typescript',
          mode: 'edit' as const,
          isDirty: false
        }
      ]
    }
    const snapshots = buildMobileSessionTabSnapshots(clientState, false)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.tabs).toMatchObject([
      { type: 'file', id: 'local-file', filePath: '/repo/local.ts' }
    ])
    expect(snapshots[0]?.tabGroups?.flatMap((group) => group.tabOrder)).not.toContain(
      'host-file-tab'
    )
    expect(buildMobileSessionTabSnapshots(mirroredState, false)).toMatchObject([
      { worktree: WT, tabs: [] }
    ])
    expect(buildMobileSessionTabSnapshots(clientState, false)[0]?.snapshotVersion).toBeGreaterThan(
      snapshots[0]!.snapshotVersion
    )
  })

  it('resyncs when only the mirror ownership flag changes', () => {
    const mirroredState = mirrorHostTab(fileTab)
    const ownedState = {
      ...mirroredState,
      openFiles: mirroredState.openFiles.map((file) => ({
        ...file,
        mirroredFromRuntimeSession: false
      }))
    }
    const ownedKey = getRuntimeMobileSessionSyncKey(ownedState, undefined, undefined, false)
    const mirroredKey = getRuntimeMobileSessionSyncKey(mirroredState, ownedState, ownedKey, false)
    expect(runtimeMobileSessionSyncKeysEqual(ownedKey, mirroredKey)).toBe(false)
    expect(buildMobileSessionTabSnapshots(ownedState, false)[0]?.tabs).toMatchObject([
      { type: 'file', id: 'host-file-tab' }
    ])
    expect(buildMobileSessionTabSnapshots(mirroredState, false)).toMatchObject([
      { worktree: WT, tabs: [] }
    ])
  })
})

describe('mirrored editor tab accumulation across hops', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  const markdownTab: RuntimeMobileSessionFileTab = {
    type: 'file',
    id: 'host-note-tab',
    title: 'TODO.md',
    filePath: '/repo/docs/TODO.md',
    relativePath: 'docs/TODO.md',
    language: 'markdown',
    mode: 'edit',
    isDirty: false,
    isActive: true
  }

  // Issue #31544: every relaunch or host frame used to add one more tab for the same file.
  it('keeps one mirrored file and publishes none of it over repeated host frames', () => {
    let state = makeState()
    for (let hop = 0; hop < 5; hop += 1) {
      const patch = applyWebSessionTabsSnapshot(
        state,
        makeSnapshot([markdownTab], { snapshotVersion: hop + 1 }),
        ENV,
        NOW + hop
      )
      state = { ...state, ...patch }
      const published = buildMobileSessionTabSnapshots(makePublicationState(state), false)
      expect(published.flatMap((snapshot) => snapshot.tabs)).toEqual([])
    }
    expect(state.openFiles.filter((file) => file.filePath === markdownTab.filePath)).toHaveLength(1)
    expect(
      (state.unifiedTabsByWorktree[WT] ?? []).filter((tab) => tab.contentType === 'editor')
    ).toHaveLength(1)
  })
})
