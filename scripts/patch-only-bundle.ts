/** Identify installable bundles whose npm payload is only one or more profile patch documents. */

/** Read the minimal manifest shape used by package-role detection. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Tell patch-only bundle carriers from packages that also expose runtime code.
 * @param value - Parsed package manifest.
 * @param hasSourceEntry - Whether the package has a TypeScript runtime root entry.
 * @returns True only when the manifest declares and publishes patch files with no runtime entry point.
 */
export function isPatchOnlyBundleManifest(value: unknown, hasSourceEntry = false): boolean {
  if (hasSourceEntry) return false
  const manifest = record(value)
  const dsh = record(manifest?.dsh)
  const bundle = record(dsh?.bundle)
  const rawPatch = bundle?.patch
  const patches = typeof rawPatch === 'string' ? [rawPatch]
    : Array.isArray(rawPatch) && rawPatch.every((path): path is string => typeof path === 'string')
      ? rawPatch
      : undefined
  if (patches === undefined || patches.length === 0) return false
  const paths = patches.map(path => path.replace(/^\.\//u, ''))
  if (paths.some(path => path === '' || path.startsWith('/') || path.split('/').includes('..'))
    || new Set(paths).size !== paths.length) return false
  if (['main', 'module', 'types', 'typings'].some(field => manifest?.[field] !== undefined)) return false

  const files = manifest?.files
  if (!Array.isArray(files) || !files.every(file => typeof file === 'string')
    || files.length !== paths.length || !paths.every(path => files.includes(path))) return false

  const exports = record(manifest?.exports)
  if (exports === undefined) return false
  const patchExports = new Set(paths.map(path => `./${path}`))
  for (const [subpath, target] of Object.entries(exports)) {
    if (subpath === './package.json') {
      if (target !== './package.json') return false
      continue
    }
    if (!patchExports.has(subpath) || target !== subpath) return false
  }
  return paths.every(path => exports[`./${path}`] === `./${path}`)
}
