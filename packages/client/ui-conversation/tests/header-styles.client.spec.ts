/** Conversation navigation spacing preserves the right-pane header alignment. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

describe('conversation header geometry', () => {
  it('removes the extra tab inset only in narrow Web windows', () => {
    const narrow = /@media \(max-width: 767px\) \{([\s\S]*?)\n\}/.exec(css)?.[1]
    expect(narrow).toContain(':global(html:not([data-platform])) .tabs')
    expect(narrow).toContain('padding-left: 0')
  })

  it('keeps the single-line header at the shared 76px height', () => {
    expect(css.match(/\.header\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 76px')
    expect(css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 25px')
    // The tab's 35px press target sits 10px above its 25px row through a negative top margin.
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 35px')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('margin: -10px calc(-1 * var(--dsh-tab-hit-inline)) 0')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('padding: 10px var(--dsh-tab-hit-inline) 9px')
  })

  it('clips overflowing title actions and fades them inside the gap before the next control', () => {
    const cluster = css.match(/\.titleCluster\s*\{([^}]*)\}/)?.[1]
    expect(cluster).toContain('overflow: clip')
    expect(cluster).toContain('--title-cluster-fade: 20px')
    expect(cluster).toContain('margin: -4px calc(-1 * var(--title-cluster-fade)) -4px -4px')
    expect(cluster).toContain('padding: 4px var(--title-cluster-fade) 4px 4px')
    expect(cluster).toContain('mask-image: linear-gradient(to left, transparent calc(0.3 * var(--title-cluster-fade)), #000 var(--title-cluster-fade))')
    expect(css.match(/^\.headerUtilities\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 20px')
    expect(css.match(/\.titleCluster:has\(\+ \.headerUtilities:empty\)\s*\{([^}]*)\}/)?.[1]).toContain('--title-cluster-fade: 8px')
    expect(css.match(/^\.headerCorner\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 8px')
  })

  it('uses 32px between view labels and keeps the strip a single scrollable row', () => {
    const strip = css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]
    expect(strip).toContain('gap: 32px')
    expect(strip).toContain('flex-wrap: nowrap')
    expect(strip).toContain('overflow-x: auto')
    expect(css.match(/\.tabs\s*\{([^}]*)\}/)?.[1]).toContain('gap: 20px')
    expect(css.match(/\.tabs\s*\{([^}]*)\}/)?.[1]).toContain('flex-wrap: nowrap')
  })

  it('keeps tab labels on one line without a clip width', () => {
    const label = css.match(/\.tabLabel\s*\{([^}]*)\}/)?.[1]
    expect(label).toContain('white-space: nowrap')
    expect(label).not.toContain('max-width')
  })
})
