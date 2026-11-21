import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Occupy the name slot without a wordmark for the compact NAS navigation.
 * The host retains the mark's New Session action and accessible name.
 * @returns no visible name; occupying the slot suppresses the local-build fallback.
 */
export function OfficialBrandName() {
  return null
}
