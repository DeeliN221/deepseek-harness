// @vitest-environment jsdom
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, KEY_ENTER_COMMAND } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { isMobileDevice } from '@deepseek-ai/dsh-client-ui-primitives'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ isMobileDevice: vi.fn(() => false) }))
beforeEach(() => vi.mocked(isMobileDevice).mockReturnValue(false))

function bench() {
  const editor = createEditor({ namespace: 'explicit-enter', onError: e => { throw e } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.append(root)
  editor.setRootElement(root)
  const submit = vi.fn()
  const arbitrate = vi.fn(() => 'pass' as 'pass' | 'pick-highlighted')
  const canSubmit = vi.fn(() => true)
  onTestFinished(registerPlainText(editor))
  onTestFinished(registerComposerKeymap(editor, {
    submit, arbitrate, canSubmit, space: () => false, dismissPopup: () => {},
    intakeFiles: () => {}, pasteText: () => {},
  }))
  onTestFinished(() => { editor.setRootElement(null); root.remove() })
  const enter = (modifiers: Partial<KeyboardEvent> = {}) => {
    // Command boundary stub: no GUI delivery; browsers alone can create trusted DOM events.
    const event = { key: 'Enter', ctrlKey: false, metaKey: false, altKey: false,
      shiftKey: false, repeat: false, isComposing: false, keyCode: 13, isTrusted: true,
      getModifierState: () => false, preventDefault: vi.fn(), ...modifiers } as unknown as KeyboardEvent
    editor.dispatchCommand(KEY_ENTER_COMMAND, event)
    return event
  }
  return { editor, root, submit, arbitrate, canSubmit, enter }
}

const variants = Array.from({ length: 16 }, (_, bits) => ({
  ctrlKey: Boolean(bits & 1), metaKey: Boolean(bits & 2),
  altKey: Boolean(bits & 4), shiftKey: Boolean(bits & 8),
}))

describe('explicit composer send boundary', () => {
  it('ordinary and Shift+Enter insert newlines without submitting', () => {
    const b = bench()
    b.editor.update(() => {
      const p = $createParagraphNode().append($createTextNode('first'))
      $getRoot().append(p); p.selectEnd()
    }, { discrete: true })
    b.enter()
    b.enter({ shiftKey: true })
    b.editor.update(() => {}, { discrete: true })
    expect(b.submit).not.toHaveBeenCalled()
    expect(b.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('first\n\n')
  })
  it.each([{ ctrlKey: true }, { metaKey: true }])('primary %j sends with normal Queue/Steer policy', modifiers => {
    const b = bench(); b.enter(modifiers)
    expect(b.submit).toHaveBeenCalledExactlyOnceWith(false)
  })
  it('Alt+Enter chooses the complementary Queue/Steer policy', () => {
    const b = bench(); b.enter({ altKey: true })
    expect(b.submit).toHaveBeenCalledExactlyOnceWith(true)
  })
  it.each(variants)('mobile Enter %j never sends', modifiers => {
    vi.mocked(isMobileDevice).mockReturnValue(true)
    const b = bench(); b.enter(modifiers)
    expect(b.submit).not.toHaveBeenCalled()
  })
  it.each([
    ['slash', {}], ['slash', { ctrlKey: true }], ['slash', { metaKey: true }], ['slash', { altKey: true }],
    ['reference', {}], ['reference', { ctrlKey: true }], ['reference', { metaKey: true }], ['reference', { altKey: true }],
  ])('%s menu selection consumes Enter %j without sending', (_menu, modifiers) => {
    const b = bench(); b.arbitrate.mockReturnValue('pick-highlighted')
    expect(b.enter(modifiers as Partial<KeyboardEvent>).preventDefault).toHaveBeenCalledOnce()
    expect(b.submit).not.toHaveBeenCalled()
  })
  it('held, untrusted, no-event, locked, and malformed chords never send', () => {
    const b = bench()
    b.enter({ ctrlKey: true, repeat: true })
    b.enter({ ctrlKey: true, isTrusted: false })
    b.editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    b.enter({ ctrlKey: true, metaKey: true })
    b.enter({ ctrlKey: true, altKey: true })
    b.canSubmit.mockReturnValue(false); b.enter({ ctrlKey: true })
    expect(b.submit).not.toHaveBeenCalled()
  })
  it.each([false, true])('IME/dictation completion retains all segments, mobile=%s', mobile => {
    vi.mocked(isMobileDevice).mockReturnValue(mobile)
    vi.useFakeTimers()
    onTestFinished(() => vi.useRealTimers())
    const b = bench()
    for (const segment of ['第一段', '第二段', '第三段']) {
      fireEvent.compositionStart(b.root)
      b.editor.update(() => {
        const root = $getRoot()
        const p = root.getFirstChild() ?? $createParagraphNode()
        if (p.getParent() === null) root.append(p)
        if ('append' in p) p.append($createTextNode(segment))
      }, { discrete: true })
      b.enter({ ctrlKey: true, isComposing: true })
      fireEvent.compositionEnd(b.root, { data: segment })
      b.enter({ ctrlKey: true }) // Safari late composition-closing keydown
      b.enter({ keyCode: 229, metaKey: true })
      b.enter({ isTrusted: false }) // dictation-generated completion
      vi.advanceTimersByTime(20) // next segment begins outside Safari's closing guard
      b.enter({ isTrusted: false, ctrlKey: true })
      b.editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    }
    b.editor.update(() => { $getRoot().getLastDescendant()?.selectEnd() }, { discrete: true })
    b.enter() // a later ordinary Enter edits the complete multi-segment draft
    b.editor.update(() => {}, { discrete: true })
    expect(b.submit).not.toHaveBeenCalled()
    expect(b.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('第一段第二段第三段\n')
  })
})
