/** Shared rendering of plugin-owned panel icons in navigation rows and menus. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { NavGlyph, type NavGlyphName } from './nav-icons.tsx'
import type {} from './contract/slots.ts'

/**
 * Panels whose sidebar glyph is the animated set. Every other panel keeps the
 * icon its own registrant renders into `sidebar.panellist`, so a third-party
 * panel is never required to know about this package's artwork.
 */
const ANIMATED_GLYPHS: Readonly<Record<string, NavGlyphName>> = {
  'dsh-task-center': 'task-center',
  'task-board': 'task-board',
  'dsh-context': 'context-insight',
  'bot-team': 'bot-team',
}

/**
 * Render the icon registered for one panel at the caller's size and selection state.
 * @param props - Panel identity, icon presentation, and the authorized child renderer.
 * @returns The matching panel icon.
 */
export function PanelIcon({ id, size, active, renderSlot }: FactoryComponentPropsOf<'sidebar.panel.icon'>) {
  const glyph = ANIMATED_GLYPHS[id]
  if (glyph !== undefined) return <NavGlyph name={glyph} size={size} panelId={id} />
  return renderSlot('sidebar.panellist', { size, active }, { only: id })
}
