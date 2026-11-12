// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' })
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux armv8l' })
  Object.defineProperty(InputEvent.prototype, 'getTargetRanges', { configurable: true, value() { return [] } })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
})
import { $getRoot, $isTextNode, REDO_COMMAND, UNDO_COMMAND } from 'lexical'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'

function bench() {
  const runtime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() }, quoteLabels: () => ({ remove: 'remove' }),
    openReference: () => false, lexicon: () => new Map(), resolveLexicon: () => undefined,
  })
  const off = runtime.register()
  const root = document.createElement('div')
  root.setAttribute('contenteditable', 'true')
  document.body.append(root)
  runtime.editor.setRootElement(root)
  runtime.setDraft('')
  root.focus()
  onTestFinished(() => { off(); root.remove() })
  const flush = async () => { await Promise.resolve(); runtime.editor.update(() => {}, { discrete: true }); await Promise.resolve() }
  const selectDOM = async (start: number, end = start, index = 0) => {
    const text = root.querySelectorAll('[data-lexical-text]')[index]?.firstChild
    if (!text) throw new Error('Missing text DOM')
    window.getSelection()!.setBaseAndExtent(text, start, text, end)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()
    return text
  }
  const before = (inputType: string, data: string | null, start?: number, end = start) => {
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data })
    if (start !== undefined) {
      const node = root.querySelector('[data-lexical-text]')!.firstChild!
      const range = new StaticRange({ startContainer: node, startOffset: start, endContainer: node, endOffset: end! })
      Object.defineProperty(event, 'getTargetRanges', { value: () => [range] })
    }
    root.dispatchEvent(event)
    return event
  }
  const native = async (inputType: string, data: string, nextText?: string) => {
    const selected = window.getSelection()!.anchorNode
    let text = selected?.nodeType === Node.TEXT_NODE ? selected : root.querySelector('[data-lexical-text]')?.firstChild
    if (!text) {
      text = document.createTextNode('')
      root.querySelector('p')!.replaceChildren(text)
    }
    const current = text.textContent ?? ''
    const at = window.getSelection()!.anchorOffset
    const next = nextText ?? (current === '\u200b' ? data : current.slice(0, at) + data + current.slice(at))
    text.textContent = next
    window.getSelection()!.setBaseAndExtent(text, next.length, text, next.length)
    root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data, isComposing: inputType === 'insertCompositionText' }))
    await flush()
  }
  const composition = async (data: string, nextText?: string) => {
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    await flush()
    before('insertCompositionText', data)
    await native('insertCompositionText', data, nextText)
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data }))
    await flush()
  }
  const nodes = () => runtime.editor.getEditorState().read(() => $getRoot().getAllTextNodes().map(node => ({
    key: node.getKey(), text: node.getTextContent(), unmergeable: node.isUnmergeable(),
  })))
  return { runtime, root, flush, selectDOM, before, native, composition, nodes, off }
}

describe('Android dictation DOM events', () => {
  it('retains two native multi-composition segments without a keydown', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    await b.composition('第一段')
    expect(b.runtime.projection.clipboardText).toBe('前文第一段')
    await b.composition('第二段')
    expect(b.runtime.projection.clipboardText).toBe('前文第一段第二段')
  })
  it('limits a new collapsed composition DOM rewrite to its own segment', async () => {
    const b = bench()
    b.runtime.setDraft('第一段')
    await b.selectDOM(3)
    await b.composition('第二段', '第二段')
    expect(b.runtime.projection.clipboardText).toBe('第一段第二段')
  })
  it('inserts vendor dictation input at collapsed range', async () => {
    const b = bench()
    b.runtime.setDraft('第一段')
    await b.selectDOM(3)
    const event = b.before('insertFromDictation', '第二段', 3)
    await b.flush()
    // A canceled event must have applied its text before returning.
    expect({ prevented: event.defaultPrevented, text: b.runtime.projection.clipboardText }).toEqual({ prevented: true, text: '第一段第二段' })
  })
  it('uses replacement target range without discarding earlier text', async () => {
    const b = bench()
    b.runtime.setDraft('第一段旧识别')
    await b.selectDOM(6)
    b.before('insertReplacementText', '第二段', 3, 6)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('第一段第二段')
  })
  it('revises one active segment without appending earlier interim results', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    b.before('insertCompositionText', '初稿')
    await b.native('insertCompositionText', '初稿', '初稿')
    b.before('insertCompositionText', '修订稿')
    await b.native('insertCompositionText', '修订稿', '修订稿')
    b.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '修订稿' }))
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文修订稿')
  })
  it('retains suffix when composition starts in the middle of text', async () => {
    const b = bench()
    b.runtime.setDraft('左右')
    await b.selectDOM(1)
    await b.composition('中', '中')
    expect(b.runtime.projection.clipboardText).toBe('左中右')
  })
  it('permits selected text to be replaced by composition', async () => {
    const b = bench()
    b.runtime.setDraft('第一段')
    await b.selectDOM(0, 3)
    await b.composition('替换', '替换')
    expect(b.runtime.projection.clipboardText).toBe('替换')
  })
  it('cancels an empty composition without dropping committed text', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    b.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文')
  })
  it('undoes a committed composition without losing its prefix', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    await b.composition('后文', '后文')
    b.runtime.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文')
  })
  it('continues ordinary insertion and backspace after composition', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    await b.composition('后文', '后文')
    const event = b.before('insertText', '!')
    if (!event.defaultPrevented) await b.native('insertText', '!')
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文后文!')
    b.before('deleteContentBackward', null)
    // Android Chrome performs the DOM deletion even after preventDefault.
    const selected = window.getSelection()!
    const text = selected.anchorNode!.textContent!
    const at = selected.anchorOffset
    await b.native('deleteContentBackward', '', text.slice(0, at - 1) + text.slice(at))
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文后文')
  })
  it('retains an atomic reference beside multiple composition sessions', async () => {
    const b = bench()
    b.runtime.setDraft('前后')
    b.runtime.insertReference({ start: 1, end: 1 }, { source: 'file', ref: '/a', label: 'a', clipboardText: '@a' }, '后')
    const texts = b.root.querySelectorAll('[data-lexical-text]')
    const end = texts[texts.length - 1]!.textContent!.length
    await b.selectDOM(end, end, texts.length - 1)
    await b.composition('第一段', '第一段')
    await b.composition('第二段', '第二段')
    expect(b.runtime.projection.clipboardText).toBe('前@a 后第一段第二段')
    expect(b.runtime.projection.occurrences).toHaveLength(1)
    expect(b.runtime.projection.occurrences[0]?.ref).toBe('/a')
  })
  it('uses explicit dictation replacement ranges and selected ranges', async () => {
    const b = bench()
    b.runtime.setDraft('前文旧词')
    await b.selectDOM(4)
    b.before('insertFromDictation', '新词', 2, 4)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文新词')
    await b.selectDOM(0, 4)
    b.before('insertFromDictation', '全文替换', 0, 4)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('全文替换')
  })
  it('releases temporary merge barriers after every completed segment', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    for (let i = 0; i < 4; i++) {
      await b.composition('段', '段')
      expect(b.nodes()).toHaveLength(1)
      expect(b.nodes()[0]?.unmergeable).toBe(false)
    }
    expect(b.runtime.projection.clipboardText).toBe('前文段段段段')
  })
  it('releases temporary barriers after cancellation and retains preexisting barriers', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(1)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    b.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    await b.flush()
    expect(b.nodes().every(node => !node.unmergeable)).toBe(true)
    b.runtime.editor.update(() => {
      const node = $getRoot().getFirstDescendant()
      if ($isTextNode(node)) node.toggleUnmergeable()
    }, { discrete: true })
    await b.selectDOM(2)
    await b.composition('后', '后')
    expect(b.nodes().find(node => node.text === '前文')?.unmergeable).toBe(true)
  })
  it('restores barriers on root replacement and disposal during composition', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(1)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    const replacement = document.createElement('div')
    replacement.setAttribute('contenteditable', 'true')
    document.body.append(replacement)
    onTestFinished(() => replacement.remove())
    b.runtime.editor.setRootElement(replacement)
    await b.flush()
    expect(b.nodes().every(node => !node.unmergeable)).toBe(true)
    b.off()
    await b.flush()
    expect(b.runtime.editor.getRootElement()).toBe(null)
    expect(b.nodes().every(node => !node.unmergeable)).toBe(true)
  })
  it('synchronously releases pending composition barriers on disposal', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(1)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    expect(b.nodes().some(node => node.unmergeable)).toBe(true)
    b.off()
    expect(b.nodes().every(node => !node.unmergeable)).toBe(true)
    expect(b.runtime.editor.getRootElement()).toBe(null)
  })
  it('redos a completed composition with normal mergeability', async () => {
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    await b.composition('后文', '后文')
    b.runtime.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await b.flush()
    b.runtime.editor.dispatchCommand(REDO_COMMAND, undefined)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('前文后文')
    expect(b.nodes().every(node => !node.unmergeable)).toBe(true)
  })
  it('does not isolate non-Android composition', async () => {
    const original = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop Chrome' })
    onTestFinished(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original }))
    const b = bench()
    b.runtime.setDraft('前文')
    await b.selectDOM(2)
    b.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await b.flush()
    expect(b.nodes()).toHaveLength(1)
    expect(b.nodes()[0]?.unmergeable).toBe(false)
  })
  it('preserves deliberate select-all replacement', async () => {
    const b = bench()
    b.runtime.setDraft('第一段')
    await b.selectDOM(0, 3)
    b.before('insertReplacementText', '第二段', 0, 3)
    await b.flush()
    expect(b.runtime.projection.clipboardText).toBe('第二段')
  })
})
