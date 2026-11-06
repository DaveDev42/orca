import { createElement, type ComponentProps, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useMobileNativeChatDraft,
  setMobileNativeChatDraftText
} from './mobile-native-chat-draft-store'

import { MobileNativeChatComposer as NativeChatComposer } from './MobileNativeChatComposer'
import { MobileDictationStopContext } from '../../mobile-dictation-stop-context'

const getNoComposerEditGeneration = () => 0

function MobileNativeChatComposer({
  getComposerEditGeneration = getNoComposerEditGeneration,
  ...props
}: Omit<ComponentProps<typeof NativeChatComposer>, 'getComposerEditGeneration'> & {
  getComposerEditGeneration?: () => number
}): React.JSX.Element {
  return createElement(NativeChatComposer, { ...props, getComposerEditGeneration })
}

vi.mock('../../../components/MobileSwitch', () => ({ MobileSwitch: 'Switch' }))
vi.mock('./MobileNativeChatContextUsageRing', () => ({
  useMobileNativeChatContextRing: () => ({ barProps: {}, ring: null })
}))
// BottomDrawer also carries the option pager, which loads Reanimated at import.
vi.mock('react-native-reanimated', async () =>
  (await import('../../../test-support/reanimated-pager-stub')).reanimatedPagerStub()
)
vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ...(await import('../../../test-support/react-native-motion-stub')).reactNativeMotionStub(),
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Keyboard: { dismiss: vi.fn() },
    Platform: { OS: 'ios' },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ListEnd: 'ListEnd',
  CornerDownRight: 'CornerDownRight',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  FileText: 'FileText',
  Mic: 'Mic',
  Package: 'Package',
  Plus: 'Plus',
  ShieldAlert: 'ShieldAlert',
  Square: 'Square',
  Terminal: 'Terminal',
  X: 'X'
}))

vi.mock('../../../components/bottom-drawer/mounted-bottom-drawer', () => ({
  MountedBottomDrawer: 'BottomDrawer'
}))
vi.mock('../../../components/bottom-drawer/bottom-drawer-modal-host-scope', () => ({
  useBottomDrawerModalHost: () => null
}))

// Send while dictating: stop, wait for the words to reach the draft, then send once.
describe('MobileNativeChatComposer send during dictation', () => {
  let renderer: ReactTestRenderer | null = null
  let scope = ''
  let scopeCount = 0

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(
    mic: { micActive?: boolean; micStarting?: boolean; micProcessing?: boolean },
    stop: () => Promise<void>,
    onSend: (text: string) => Promise<boolean>,
    draft = ''
  ) {
    scopeCount += 1
    scope = `dictation-send-${scopeCount}`
    setMobileNativeChatDraftText(scope, draft)
    function Registered() {
      const value = useMobileNativeChatDraft(scope)
      return createElement(
        MobileDictationStopContext.Provider,
        { value: stop },
        createElement(MobileNativeChatComposer, {
          value,
          draftScopeKey: scope,
          onChangeText: (text: string) => setMobileNativeChatDraftText(scope, text),
          onSend,
          sendSurfaceId: scope,
          getSendCompletionGeneration: () => 0,
          onMicPress: () => {},
          ...mic
        })
      )
    }
    await act(async () => {
      renderer = create(createElement(Registered))
    })
  }

  function sendButton() {
    return renderer!.root.find(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Send message'
    )
  }

  const tapSend = () => act(async () => sendButton().props.onPress())

  // The hook delivers the transcript into the draft, then resolves the stop.
  function deferredStop() {
    let finish: (transcript: string) => Promise<void> = async () => {}
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = async (transcript) => {
            await act(async () => {
              if (transcript) {
                setMobileNativeChatDraftText(scope, (draft: string) => draft + transcript)
              }
              resolve()
            })
          }
        })
    )
    return { stop, finish: (transcript: string) => finish(transcript) }
  }

  it('sends once with the transcript when Send is tapped while recording, even from an empty draft', async () => {
    const { stop, finish } = deferredStop()
    const onSend = vi.fn(async (_text: string) => true)
    await render({ micActive: true }, stop, onSend)
    expect(sendButton().props.accessibilityState.disabled).toBe(false)
    await tapSend()
    await tapSend()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
    await finish('fix the flaky test')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0]![0]).toBe('fix the flaky test')
  })

  it('waits for the transcript already being produced when Send is tapped while processing', async () => {
    const { stop, finish } = deferredStop()
    const onSend = vi.fn(async (_text: string) => true)
    await render({ micProcessing: true }, stop, onSend, 'Please ')
    await tapSend()
    expect(onSend).not.toHaveBeenCalled()
    await finish('run the tests')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0]![0]).toBe('Please run the tests')
  })

  it('sends the draft as it stands when the transcript comes back empty or fails', async () => {
    const { stop, finish } = deferredStop()
    const onSend = vi.fn(async (_text: string) => true)
    await render({ micActive: true }, stop, onSend, 'typed earlier')
    await tapSend()
    await finish('')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0]![0]).toBe('typed earlier')
  })

  it('sends nothing when the transcript fails and the draft is empty', async () => {
    const { stop, finish } = deferredStop()
    const onSend = vi.fn(async (_text: string) => true)
    await render({ micActive: true }, stop, onSend)
    await tapSend()
    await finish('')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps Send disabled while the mic is still starting and the draft is empty', async () => {
    const stop = vi.fn(async () => {})
    await render({ micActive: true, micStarting: true }, stop, async () => true)
    expect(sendButton().props.accessibilityState.disabled).toBe(true)
  })
})
