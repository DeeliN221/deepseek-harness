/**
 * Framework-free warning that names the client rows which did not start after
 * the shell mounted over them. It lives outside the React mount point, so it
 * survives renderer hydration and every degraded plugin.
 * @module @deepseek-ai/dsh-client-web/src/boot-notice
 */
import css from './boot-notice.module.css'
import { bootNoticeTranslator } from './locales/boot-notice.ts'

/** Create one div in the notice's document with a class and, optionally, text. */
function div(doc: Document, className: string | undefined, text?: string): HTMLDivElement {
  const element = doc.createElement('div')
  element.className = className ?? ''
  if (text !== undefined) element.textContent = text
  return element
}

/**
 * Attach the startup notice for entries that did not activate, and keep it
 * until the user dismisses it or the shell disposes.
 * @param failures - non-active entries reported by the boot chain.
 * @param doc - document that owns the notice.
 * @returns disposer detaching the notice.
 */
export function renderBootNotice(failures: readonly { name: string; reason: string }[], doc: Document): () => void {
  const t = bootNoticeTranslator(doc.documentElement.lang)
  const root = div(doc, css.notice)
  root.dataset.dshBootNotice = ''
  root.setAttribute('role', 'region')

  const content = div(doc, css.content)
  content.setAttribute('role', 'status')
  content.setAttribute('aria-live', 'polite')
  const title = div(doc, css.title, t(failures.length === 1 ? 'notice.one' : 'notice.many', { count: failures.length }))
  let titleIndex = 0
  while (doc.getElementById(`dsh-boot-notice-title-${String(titleIndex)}`) !== null) titleIndex++
  title.id = `dsh-boot-notice-title-${String(titleIndex)}`
  root.setAttribute('aria-labelledby', title.id)
  const rows = div(doc, css.rows)
  for (const failure of failures) {
    const row = div(doc, css.row)
    row.append(div(doc, css.id, failure.name), div(doc, css.reason, failure.reason))
    rows.append(row)
  }
  const hint = div(doc, css.hint, t('notice.hint'))

  const dismiss = doc.createElement('button')
  dismiss.type = 'button'
  dismiss.className = css.dismiss ?? ''
  dismiss.textContent = t('notice.dismiss')
  dismiss.addEventListener('click', () => { root.remove() })

  content.append(title, rows, hint)
  root.append(content, dismiss)
  doc.body.append(root)
  return () => { root.remove() }
}
