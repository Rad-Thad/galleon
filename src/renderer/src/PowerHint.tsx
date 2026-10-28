import { type JSX, useEffect, useState } from 'react'
import { POWER_HINT_NOTICE, THEMES_NOTICE } from '@shared/types'
import { FocusButton, Overlay } from './components'
import { useApp, useI18n } from './state'

/**
 * Said when Armada's power profile is one that makes browsing stutter: where
 * the player can set Performance for Galleon. Galleon cannot set it itself,
 * and does not try. Which profile counts, and when the hint is due, is the
 * main process's `decidePowerHint`.
 *
 * Asked when the window comes back to the front as well as at the start,
 * because Steam switches profiles per game. After the first-run wizard and
 * after the themes notice, so two dialogs never open over each other.
 */
export function PowerHint(): JSX.Element | null {
  const { t } = useI18n()
  const { settings, saveSettings } = useApp()
  const [profile, setProfile] = useState<string | null>(null)

  const dismissed = settings?.dismissedNotices ?? []
  // Dismissal for good is weighed by `decidePowerHint` with the rest, so the
  // answer follows the settings on disk rather than this page's copy of them.
  const ready = !!settings?.setupComplete && dismissed.includes(THEMES_NOTICE)

  useEffect(() => {
    if (!ready) return
    const ask = (): void => {
      void window.rommix.system
        .powerHint()
        .then((hint) => {
          if (hint.show) setProfile(hint.profile)
        })
        .catch(() => {})
    }
    ask()
    window.addEventListener('focus', ask)
    return () => window.removeEventListener('focus', ask)
  }, [ready])

  if (!ready || profile === null) return null

  const close = (): void => setProfile(null)
  const never = async (): Promise<void> => {
    close()
    await saveSettings({ dismissedNotices: [...dismissed, POWER_HINT_NOTICE] })
  }

  return (
    <Overlay title={t('power.hintTitle', { profile })} icon="system" onDismiss={close}>
      <p className="muted" data-power-hint>
        {t('power.hintBody')}
      </p>
      <div className="btn-row">
        <FocusButton
          icon="confirm"
          action="power-hint-ok"
          variant="primary"
          autoFocus
          onSelect={close}
        >
          {t('power.hintOk')}
        </FocusButton>
        <FocusButton icon="hide" action="power-hint-never" onSelect={() => void never()}>
          {t('power.hintNever')}
        </FocusButton>
      </div>
    </Overlay>
  )
}
