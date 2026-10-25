import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WebContents } from 'electron'
import { log } from './log.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import { extractZip } from './zip.ts'

/**
 * `report.bundle`: Report a problem, pressed the way a player presses it,
 * writes a bundle into the test home that carries no credentials.
 *
 * The bundle's files are copied into the results folder, so the bridge's
 * sanitiser reads them with the rest of the run and says in `bridge.json`
 * whether it would publish them whole; the agent holds the check to that.
 */

export const REPORT_CHECK = 'report.bundle'

/** Where in the results folder the bundle's files are put. */
export const REPORT_DIR = 'report.bundle'

/** How long the button, and then the bundle, are waited for. */
export const REPORT_TIMEOUT_MS = 20_000

/** Why the check failed. Codes, not prose: they are read by the agent. */
export const REPORT_FAILED = {
  notOpened: 'not-opened',
  noBundle: 'no-bundle',
  unreadable: 'bundle-unreadable',
  credentials: 'credentials',
  aborted: 'aborted-by-user'
} as const

/**
 * A file the bundle must never hold, by its name: the app's own settings
 * folder, where the sign-in lives, and anything named for a secret.
 */
const SECRET_NAME = /^config\/|(^|\/)(credentials?|secrets?|tokens?)(\.|$)|\.(key|pem)$/i

/**
 * A credential inside a file: a RomM token, an authorisation header, or a
 * secret's value that is not already a placeholder like `<redacted>`.
 */
const SECRET_TEXT = [
  /rmm_[A-Za-z0-9_-]{6,}/,
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /"(password|token|access_token|refresh_token|client_secret)"\s*:\s*"(?!<)[^"]+"/i
]

/**
 * Run in the page: open Settings from the menu bar, then move the highlight
 * onto the System tab and Report a problem and press A on each, through the
 * keyboard path the focus engine answers (see `GRID_CHECK`'s driver). Resolves
 * with null once the toast naming a zip is shown, or with what went wrong.
 */
export function reportProbe(timeoutMs = REPORT_TIMEOUT_MS): string {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = Date.now() + ${Math.round(timeoutMs)}
    const waitFor = async (look) => {
      while (Date.now() < until) {
        const found = look()
        if (found) return found
        await sleep(50)
      }
      return null
    }
    // An element is drawn before the focus engine knows it: it registers from
    // an effect after the render, and a hover until then is dropped, leaving
    // Enter to whatever had the highlight. So the hover is repeated until the
    // highlight is on it, a pixel apart each time, since the engine ignores a
    // move to where the pointer already is (see \`pointer\` in focus.tsx).
    const press = async (element) => {
      const box = element.getBoundingClientRect()
      let nudge = 0
      const highlighted = await waitFor(() => {
        if (element.dataset.focused === 'true') return true
        element.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: Math.round(box.left + box.width / 2) + nudge,
          clientY: Math.round(box.top + box.height / 2)
        }))
        nudge = 1 - nudge
        return element.dataset.focused === 'true'
      })
      if (!highlighted) return false
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    }
    const menu = await waitFor(() => document.querySelector('.topbar__nav [data-route="settings"]'))
    if (!menu) return 'no-menu-item'
    menu.click()
    const tab = await waitFor(() => document.querySelector('[data-screen="settings"] [data-tab="system"]'))
    if (!tab) return 'no-system-tab'
    if (!(await press(tab))) return 'system-tab-not-highlighted'
    const button = await waitFor(() =>
      document.querySelector('[data-screen="settings"] [data-action="report-problem"]')
    )
    if (!button) return 'no-report-button'
    const earlier = new Set(document.querySelectorAll('.toast'))
    if (!(await press(button))) return 'report-button-not-highlighted'
    const toast = await waitFor(() =>
      [...document.querySelectorAll('.toast')].find(
        (one) => !earlier.has(one) && /\\.zip\\b/.test(one.textContent || '')
      )
    )
    return toast ? null : 'no-toast'
  })()`
}

/** Press Report a problem in the page; null once it has written, else why not. */
export function pressReport(
  contents: Pick<WebContents, 'executeJavaScript'>,
  timeoutMs = REPORT_TIMEOUT_MS
): Promise<string | null> {
  return contents.executeJavaScript(reportProbe(timeoutMs), true).then(
    (failed: unknown) => (typeof failed === 'string' ? failed : null),
    (cause: unknown) => {
      log.warn('selftest', 'pressing Report a problem failed', { cause })
      return 'probe-failed'
    }
  )
}

/** The bundle's files that hold a credential, by name or by what is in them. */
export async function credentialFiles(dir: string, files: readonly string[]): Promise<string[]> {
  const found: string[] = []
  for (const file of files) {
    if (SECRET_NAME.test(file)) {
      found.push(file)
      continue
    }
    const text = await readFile(join(dir, file), 'utf8')
    if (SECRET_TEXT.some((pattern) => pattern.test(text))) found.push(file)
  }
  return found
}

export interface ReportDeps {
  /** The test home, whose `reports/` folder the bundle lands in. */
  home: string
  press: (signal: AbortSignal) => Promise<string | null>
}

async function zipsIn(reports: string): Promise<string[]> {
  try {
    return (await readdir(reports)).filter((name) => name.endsWith('.zip'))
  } catch {
    return []
  }
}

export function reportScenario(deps: ReportDeps): Scenario {
  return async ({ request, signal }) => {
    const metrics: CheckResult['metrics'] = { files: null, bundle: null }
    const result = (
      outcome: CheckResult['result'],
      reason: string | null,
      evidence: string[] = []
    ): CheckResult => ({
      id: REPORT_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence
    })
    const reports = join(deps.home, 'reports')
    const earlier = new Set(await zipsIn(reports))
    const failed = await deps.press(signal)
    if (signal.aborted) return result('skip', REPORT_FAILED.aborted)
    if (failed !== null) return result('fail', `${REPORT_FAILED.notOpened}:${failed}`)
    // The toast is shown once the zip is whole, so it is there to be read now.
    const added = (await zipsIn(reports)).filter((name) => !earlier.has(name)).sort()
    if (added.length !== 1) return result('fail', REPORT_FAILED.noBundle)
    metrics.bundle = `reports/${added[0]}`

    const out = join(request.resultsDir, REPORT_DIR)
    await rm(out, { recursive: true, force: true })
    await mkdir(out, { recursive: true })
    let files: string[]
    try {
      files = (await extractZip(join(reports, added[0]), out))
        .map((path) => relative(out, path).split(sep).join('/'))
        .sort()
    } catch (cause) {
      log.warn('selftest', 'the report bundle would not open', { cause })
      // Half a bundle was never scanned, so none of it is left to publish.
      await rm(out, { recursive: true, force: true })
      return result('fail', REPORT_FAILED.unreadable)
    }
    metrics.files = files.length
    const evidence = files.map((file) => `${REPORT_DIR}/${file}`)
    const leaked = await credentialFiles(out, files)
    if (leaked.length > 0) {
      // Not left for the bridge to publish: what a credential is in is the
      // one thing the results must not carry.
      await rm(out, { recursive: true, force: true })
      return result('fail', `${REPORT_FAILED.credentials}:${leaked.join(',')}`)
    }
    return result('pass', null, evidence)
  }
}
