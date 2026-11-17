/**
 * Framework-free warning that names the client rows which did not start after
 * the shell mounted over them. It lives outside the React mount point, so it
 * survives renderer hydration and every degraded plugin.
 * @module @deepseek-ai/dsh-client-web/src/boot-notice
 */
import type { ClientBootFailure } from './boot-client.ts'
import css from './boot-notice.module.css'

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
export function renderBootNotice(failures: readonly ClientBootFailure[], doc: Document): () => void {
  const root = div(doc, css.notice)
  root.dataset.dshBootNotice = ''
  root.setAttribute('role', 'status')

  const title = div(doc, css.title, failures.length === 1
    ? '1 plugin did not start'
    : `${String(failures.length)} plugins did not start`)
  const rows = div(doc, css.rows)
  for (const failure of failures) {
    const row = div(doc, css.row)
    row.append(div(doc, css.id, failure.id), div(doc, css.reason, failure.reason))
    rows.append(row)
  }
  const hint = div(doc, css.hint, 'The rest of the application keeps running. Settings → Plugins lists installed plugins.')

  const dismiss = doc.createElement('button')
  dismiss.type = 'button'
  dismiss.className = css.dismiss ?? ''
  dismiss.textContent = 'Dismiss'
  dismiss.setAttribute('aria-label', 'Dismiss the startup notice')
  dismiss.addEventListener('click', () => { root.remove() })

  root.append(title, rows, hint, dismiss)
  doc.body.append(root)
  return () => { root.remove() }
}
