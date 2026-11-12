import { act } from '@testing-library/react'
import { KEY_ENTER_COMMAND, type LexicalEditor } from 'lexical'

/** Trusted keyboard command stub; never sends a GUI message or forges a DOM event. */
export function composerEnter(root: HTMLElement, options: KeyboardEventInit = {}): boolean {
  const editor = (root as HTMLElement & { __lexicalEditor?: LexicalEditor }).__lexicalEditor
  if (editor === undefined) throw new Error('Expected a Lexical composer root')
  let prevented = false
  const event = {
    key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, keyCode: 13, ...options, isTrusted: true,
    getModifierState: () => false, preventDefault: () => { prevented = true },
  } as unknown as KeyboardEvent
  act(() => { editor.dispatchCommand(KEY_ENTER_COMMAND, event) })
  return !prevented
}
