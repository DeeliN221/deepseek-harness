/** Local Markdown destinations accepted by the file-preview callback. */

/**
 * Recognize a complete prose/code path candidate before consulting metadata.
 * @param value - Authored token, including optional line information.
 * @returns Whether the token has a path separator or a filename suffix.
 */
export function isFilePathCandidate(value: string): boolean {
  const file = parseFileLink(value)
  if (file === undefined) return false
  return isExplicitFilePath(file.path) || /[\\/]/.test(file.path)
    || /^(?:[^\s]*\.[a-z\d]+|README|Makefile|Dockerfile|LICENSE|AGENTS)$/i.test(file.path)
}

/**
 * Recognize a relative, rooted, or absolute Windows path before URL parsing.
 * @param value - A decoded or URI-normalized destination.
 * @returns Whether a filesystem prefix makes the destination unambiguous.
 */
export function isExplicitFilePath(value: string): boolean {
  return /^(?:[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(value)
}

/**
 * Decode a file destination with a fragment, line range, or line/column suffix.
 * File URLs, explicit relative, slash/backslash-rooted, Windows drive paths,
 * and bare filenames with numeric line suffixes take precedence over URLs.
 * Other parseable absolute URLs are not file links.
 * Fragments take precedence over colon suffixes; invalid locations open the
 * file without selecting a line. Columns are consumed but not selected.
 * Percent-encode literal `?`, `#`, and numeric colon suffixes in filenames.
 * @param value - Parsed Markdown link destination.
 * @returns A local path and optional first line, or undefined for URLs,
 * fragment-only links, queries, malformed escapes, or control characters.
 */
export function parseFileLink(value: string): { path: string; line?: number } | undefined {
  if (/^file:/i.test(value)) {
    if (!URL.canParse(value)) return undefined
    const url = new URL(value)
    if (url.search !== '') return undefined
    const path = url.hostname === '' || url.hostname === 'localhost' ? url.pathname : `//${url.hostname}${url.pathname}`
    return parseFileLink(path.replace(/^\/([a-z]:\/)/i, '$1') + url.hash)
  }
  const hash = value.indexOf('#')
  const destination = hash < 0 ? value : value.slice(0, hash)
  if (destination.includes('?')) return undefined
  let path: string
  try {
    path = decodeURIComponent(destination)
  } catch (_error) {
    // Malformed percent escapes cannot identify a file unambiguously.
    return undefined
  }
  if (path.length === 0 || /[\u0000-\u001f\u007f]/.test(path)) return undefined
  const suffix = hash < 0 ? /:(\d+)(?::\d+|-(\d+))?$/.exec(destination) : null
  const bareFileLine = suffix !== null && /^(?:[^:]*\.[a-z\d]+|README|Makefile|Dockerfile|LICENSE|AGENTS)$/i
    .test(path.slice(0, -suffix[0].length))
  if (!isExplicitFilePath(path) && !bareFileLine && URL.canParse(path)) return undefined
  if (suffix !== null) path = path.slice(0, -suffix[0].length)
  if (path.length === 0) return undefined
  const match = suffix ?? (hash < 0 ? null : /^L(\d+)(?:-L(\d+))?$/.exec(value.slice(hash + 1)))
  if (match === null) return { path }
  const line = Number(match[1])
  const end = match[2] === undefined ? line : Number(match[2])
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(end) || line < 1 || end < line) return { path }
  return { path, line }
}
