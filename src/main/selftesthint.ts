import { join } from 'node:path'
import type { WebContents } from 'electron'
import { POWER_HINT_NOTICE, type PowerState, type Settings } from '@shared/types'
import { SLOW_PROFILES } from './powerhint.ts'
import { log } from './log.ts'
import { UNKNOWN } from './powerstate.ts'
import { SKIP, type CheckResult, type Scenario } from './selftest.ts'
import type { ProfileAnswer } from './selftestscroll.ts'
import { writeWhole } from './selftestshots.ts'

/**
 * `power.hint`: the power profile hint, asked for the way the page asks when
 * the window comes to the front, on each power profile the request names. It
 * must show on a profile that holds the interface back and not on one that
 * does not.
 *
 * A self-test home has every notice dismissed, so other checks are never
 * covered by a dialog. Here the dismissal and the profile last seen are
 * cleared for each profile, which makes the hint due as on a first sighting,
 * and both are put back afterwards.
 *
 * The hint is drawn over Home, which shows the owner's library, so only the
 * dialog's own panel is captured, never the screen around it.
 */

export const POWER_HINT_CHECK = 'power.hint'

/** How long the page is given to raise the hint, and, where none is due, to stay without it. */
export const HINT_WAIT_MS = 5_000

/** The dialog the hint is drawn in. */
export const HINT_PANEL = `document.querySelector('[data-power-hint]')?.closest('[role="dialog"]')`

/** Under the results folder, as the run's other screenshots. */
export const hintShot = (profile: string): string => `shots/power-hint-${profile}.png`

export interface PowerHintDeps {
  /** The power state with `armada-power status` asked, which names the profile. */
  power: () => Promise<PowerState>
  askForProfile: (profile: string, signal: AbortSignal) => Promise<ProfileAnswer>
  store: { settings: Settings; updateSettings(patch: Partial<Settings>): Settings }
  /** Ask for the hint as a return to the front does; whether it showed within `waitMs`. */
  ask: (waitMs: number) => Promise<boolean>
  /** The hint's panel as a PNG, or null when it could not be captured. */
  capture: () => Promise<Buffer | null>
  /** Close it with OK, as a player would. */
  close: () => Promise<void>
  resultsDir: string
  waitMs?: number
}

/**
 * Passes when the hint showed on every slow profile named (with its panel
 * captured) and on no other. A profile run.sh could not put in force is
 * `skip` / `profile-not-set` unless another already failed; with no profile
 * named, or off Armada, there is nothing to judge.
 */
export function powerHintScenario(deps: PowerHintDeps): Scenario {
  return async ({ request, signal }) => {
    const result = (
      verdict: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics'],
      evidence: string[] = []
    ): CheckResult => ({
      id: POWER_HINT_CHECK,
      result: verdict,
      metrics,
      thresholds: {},
      reason,
      evidence
    })
    const profiles = request.profiles.map((p) => p.toLowerCase())
    if (profiles.length === 0) return result('skip', 'no-profiles', {})
    if ((await deps.power()).defaultProfile === UNKNOWN) return result('skip', 'not-armada', {})

    const kept = deps.store.settings
    const metrics: CheckResult['metrics'] = {}
    const evidence: string[] = []
    const failed: string[] = []
    const notSet: string[] = []
    try {
      for (const profile of profiles) {
        if (signal.aborted) return result('skip', SKIP.aborted, metrics, evidence)
        const now = (await deps.power()).profile.toLowerCase()
        if (now !== profile) {
          const answer = await deps.askForProfile(profile, signal)
          const after = (await deps.power()).profile.toLowerCase()
          if (after !== profile) {
            metrics[`${profile}.profileObserved`] = after
            metrics[`${profile}.profileAnswer`] = answer
            notSet.push(profile)
            continue
          }
        }
        deps.store.updateSettings({
          dismissedNotices: kept.dismissedNotices.filter((n) => n !== POWER_HINT_NOTICE),
          powerProfileSeen: ''
        })
        const due = SLOW_PROFILES.has(profile)
        const shown = await deps.ask(deps.waitMs ?? HINT_WAIT_MS)
        metrics[`${profile}.shown`] = shown ? 1 : 0
        if (shown) {
          const png = await deps.capture()
          if (png) {
            const path = hintShot(profile)
            writeWhole(join(deps.resultsDir, path), png)
            evidence.push(path)
          } else if (due) failed.push(`${profile}:not-captured`)
          await deps.close()
        }
        if (shown !== due) failed.push(`${profile}:${shown ? 'shown' : 'not-shown'}`)
      }
    } finally {
      deps.store.updateSettings({
        dismissedNotices: kept.dismissedNotices,
        powerProfileSeen: kept.powerProfileSeen
      })
    }
    if (failed.length) return result('fail', failed.join(','), metrics, evidence)
    if (notSet.length) return result('skip', 'profile-not-set', metrics, evidence)
    return result('pass', null, metrics, evidence)
  }
}

/** `ask`, `capture` and `close` against the app's page. */
export function hintPage(
  contents: Pick<WebContents, 'executeJavaScript' | 'capturePage'>
): Pick<PowerHintDeps, 'ask' | 'capture' | 'close'> {
  return {
    ask: (waitMs) =>
      contents
        .executeJavaScript(
          `(async () => {
            window.dispatchEvent(new Event('focus'))
            const until = Date.now() + ${Number(waitMs)}
            while (Date.now() < until) {
              if (${HINT_PANEL}) return true
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            return false
          })()`,
          true
        )
        .then((shown: unknown) => shown === true),
    capture: async () => {
      try {
        const rect = (await contents.executeJavaScript(
          `(() => {
            const r = ${HINT_PANEL}?.getBoundingClientRect()
            return r ? { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } : null
          })()`,
          true
        )) as { x: number; y: number; width: number; height: number } | null
        if (!rect || rect.width <= 0 || rect.height <= 0) return null
        const png = (await contents.capturePage(rect)).toPNG()
        return png.length ? png : null
      } catch (cause) {
        log.warn('selftest', 'the power hint could not be captured', { cause })
        return null
      }
    },
    close: async () => {
      await contents
        .executeJavaScript(`document.querySelector('[data-action="power-hint-ok"]')?.click()`, true)
        .catch(() => undefined)
    }
  }
}
