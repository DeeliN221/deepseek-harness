/** Sidebar settings entry that keeps the account notification lifecycle mounted. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Toast, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import type {} from './account-ui.ts'
import css from './AccountMenu.module.css'

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsRenderSlots<'settings.launcher.notifications'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, openOnboarding, settingsOpen,
  useAccount, useTheme, refreshAccount, renderSlot,
  showLogin, start, cancel, t,
}: AccountMenuProps) {
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const openAccount = useCallback(() => { openSettings('account') }, [openSettings])
  return <div className={css.root} data-inset={signedIn && wide}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    <div className={css.notifications} hidden={!wide}>{renderSlot('settings.launcher.notifications', {
      active: signedIn && !account.desktopOnboardingVisible && !account.onboarding, openAccount,
    })}</div>
    {/* The trigger is a Settings entry: one click opens the dialog, no menu. */}
    <button
      type="button"
      className={css.trigger}
      data-collapsed={!wide}
      data-dshsn-settings
      aria-label={t('settings')}
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      aria-keyshortcuts={settingsShortcut?.aria}
      onClick={() => { openSettings() }}
    >
      <IconSettingsOutlineMedium size={wide ? 16 : 18} />
    </button>
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t}
      close={() => { showLogin(false) }} useApiKey={() => { showLogin(false); openOnboarding('deepseek-official') }} />}
  </div>
}
