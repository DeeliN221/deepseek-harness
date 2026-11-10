/** Plugin discovery while reachable, and Creator draft creation, for the left sidebar. */
import {
  IconPluginPinwheelOutlineRegular, IconPlusOutlineRegular, MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Navigation region whose More menu hosts the registration; plugin actions live in the left sidebar only. */
export type EntryRegion = 'sidebar'

/** Region identity and footer actions injected into each registration. */
export interface EntryMenuInjected {
  /** Region of this registration; selects analytics attributes and the Creator prompt. */
  readonly region: EntryRegion
  readonly hooks: {
    /** Whether the Plugins page navigation service is present; the discovery row shows only while it is. */
    readonly pluginNavigation: HostObservable<boolean>
  }
  /** Open the Plugins main list. */
  readonly browsePlugins: () => void
  /** Start a Creator draft with this region's prompt without sending it. */
  readonly createPlugin: () => void
}

// The sidebar's slot owns this registration; plugin navigation and Creator are its only rows.
type EntryMenuContentProps = PropsRuntime<'sidebar.panellist.actions'>
  & PropsLocale<'entryCustomization'> & InjectFace<EntryMenuInjected>

/**
 * Render plugin discovery followed by the Creator action for the left sidebar.
 * @param props - Owner dismissal callback, injected actions, and localized copy.
 * @returns Menu rows for the sidebar's More menu.
 */
export function EntryMenuContent({
  onDismiss, usePluginNavigation, browsePlugins, createPlugin, t,
}: EntryMenuContentProps) {
  const browsable = usePluginNavigation(present => present)
  return <>
    {browsable && <MenuItemButton icon={<IconPluginPinwheelOutlineRegular size={16} />}
      onSelect={() => { onDismiss(); browsePlugins() }}>
      {t('install')}
    </MenuItemButton>}
    <MenuItemButton icon={<IconPlusOutlineRegular size={16} />}
      onSelect={() => { onDismiss(); createPlugin() }}>
      {t('create')}
    </MenuItemButton>
  </>
}
