import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { log } from './log.ts'
import { homeFromEnvironment } from './root.ts'
import type { ReadOnlyGuard } from './romm/guard.ts'
import type { ShotsOutcome } from './selftestshots.ts'

/**
 * The device self-test: what the harness on the Nova asks a Galleon in a test
 * home to do, and the `summary.json` it gets back (docs/TESTING.md).
 *
 * Kept apart from Electron so the request, the runner and the summary are
 * tested here in full; `index.ts` only decides when to call them and quits.
 */

/** Written by run.sh into `$GALLEON_HOME`. */
export const REQUEST_FILE = 'self-test-request.json'
/**
 * What the request is renamed to once taken, so a restart of the app (a crash,
 * a relaunch by the harness) is a normal start rather than a second run.
 */
export const TAKEN_FILE = 'self-test-request.taken.json'
export const SUMMARY_FILE = 'summary.json'

export const STATUSES = [
  'complete',
  'partial',
  'skipped',
  'aborted-by-user',
  'error',
  'withheld'
] as const
export type Status = (typeof STATUSES)[number]
export const RESULTS = ['pass', 'fail', 'skip', 'error'] as const
export type Result = (typeof RESULTS)[number]

export interface SelfTestRequest {
  schema: 1
  sha: string
  /** The version `build-info.json` names, or null when the harness gave none. */
  version: string | null
  budgetSeconds: number
  /**
   * When the run must end whenever it started, as an ISO time, or null. The
   * budget alone counts from the app's own start, which the harness cannot
   * time exactly, while the harness stops the app at a time of its own.
   */
  deadline: string | null
  resultsDir: string
  handshakeDir: string | null
  checks: string[]
  profiles: string[]
  payloads: Record<string, string>
  /** Emulators whose payload writes a save; see `launchCycle`'s `expectSave`. */
  savingPayloads: string[]
  fakeRomm: unknown
  readOnlyServer: true
  privacy: true
  abortOnInput: boolean
  screenshots: string[]
}

export interface CheckResult {
  id: string
  result: Result
  metrics: Record<string, number | string | null>
  thresholds: Record<string, number>
  reason: string | null
  evidence: string[]
}

export interface Safety {
  serverWritesAttempted: number
  deviceIdOnSaveRequests: number
  ownerStateChanged: string[]
  romsDownloadedBytes: number
  romsLeft: number
}

export interface Summary {
  schema: 1
  sha: string
  version: string
  status: Status
  reason: string | null
  startedAt: string
  finishedAt: string
  device: Record<string, string | number | null>
  power: Record<string, string | number | boolean | null>
  safety: Safety
  checks: CheckResult[]
  notes: string[]
}

/** What a scenario is given. Scenarios add to `safety` what only they know. */
export interface ScenarioContext {
  request: SelfTestRequest
  safety: Safety
  signal: AbortSignal
}

/**
 * One requested check id's work. It may answer for several ids, as a scroll
 * measured once per power profile answers `grid.scroll@<profile>` for each.
 */
export type Scenario = (context: ScenarioContext) => Promise<CheckResult | CheckResult[]>

/**
 * Checks the runner answers itself, after every scenario, because they are
 * about the run as a whole rather than any one part of it.
 */
export const RUN_CHECKS = {
  complete: 'selftest.complete',
  serverReadOnly: 'safety.server-readonly'
} as const

/** Why a check was not run. Codes, not prose: they are read by the agent. */
export const SKIP = {
  notImplemented: 'not-implemented',
  budget: 'budget-exhausted',
  aborted: 'aborted-by-user'
} as const

export type Taken =
  | { kind: 'request'; request: SelfTestRequest }
  | { kind: 'refused'; reason: string; resultsDir: string | null; sha: string | null }

/**
 * The request in the test home, taken so it runs once, or null for a normal
 * start.
 *
 * Only a `GALLEON_HOME` is looked in: the owner's own Galleon never runs a
 * self-test whatever is in its folder. The file is renamed before it is read,
 * so even a request that crashes the app on parsing is not met again on the
 * next start.
 */
export function takeRequest(home = homeFromEnvironment()): Taken | null {
  if (!home) return null
  const from = join(home, REQUEST_FILE)
  const to = join(home, TAKEN_FILE)
  if (!existsSync(from)) return null
  try {
    renameSync(from, to)
  } catch (cause) {
    log.warn('selftest', 'could not take the request', { reason: (cause as Error).message })
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(to, 'utf8'))
  } catch {
    return { kind: 'refused', reason: 'request-unreadable', resultsDir: null, sha: null }
  }
  return parseRequest(raw)
}

const SHA = /^[0-9a-f]{40}$/
/**
 * A version as package.json writes one. The request's is copied into the
 * published summary, so nothing that could carry more than a version gets in.
 */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/

/**
 * The request, or why it is refused.
 *
 * A request that does not ask for the read-only server and privacy is refused
 * outright rather than run with them forced on: the harness that wrote it is
 * out of step with this build, and the summary saying so is worth more than a
 * run whose other settings may be just as wrong.
 */
export function parseRequest(raw: unknown): Taken {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const resultsDir =
    typeof r.resultsDir === 'string' && isAbsolute(r.resultsDir) && !r.resultsDir.includes('\0')
      ? r.resultsDir
      : null
  const sha = typeof r.sha === 'string' && SHA.test(r.sha) ? r.sha : null
  const refuse = (reason: string): Taken => ({ kind: 'refused', reason, resultsDir, sha })
  if (r.schema !== 1) return refuse('request-schema')
  if (!resultsDir) return refuse('request-results-dir')
  if (!sha) return refuse('request-sha')
  if (r.readOnlyServer !== true) return refuse('request-not-read-only')
  if (r.privacy !== true) return refuse('request-not-private')
  if (!isStringArray(r.checks)) return refuse('request-checks')
  if (typeof r.budgetSeconds !== 'number' || !(r.budgetSeconds > 0)) return refuse('request-budget')
  const deadline = r.deadline ?? null
  if (deadline !== null && (typeof deadline !== 'string' || !isIsoTime(deadline))) {
    return refuse('request-deadline')
  }
  if (r.profiles !== undefined && !isStringArray(r.profiles)) return refuse('request-profiles')
  if (r.screenshots !== undefined && !isStringArray(r.screenshots)) {
    return refuse('request-screenshots')
  }
  const version = r.version === undefined ? null : r.version
  if (version !== null && (typeof version !== 'string' || !VERSION.test(version))) {
    return refuse('request-version')
  }
  const payloads = typeof r.payloads === 'object' && r.payloads !== null ? r.payloads : {}
  if (!Object.values(payloads).every((p) => typeof p === 'string')) {
    return refuse('request-payloads')
  }
  if (r.savingPayloads !== undefined && !isStringArray(r.savingPayloads)) {
    return refuse('request-saving-payloads')
  }
  return {
    kind: 'request',
    request: {
      schema: 1,
      sha,
      version,
      budgetSeconds: r.budgetSeconds,
      deadline,
      resultsDir,
      handshakeDir: typeof r.handshakeDir === 'string' ? r.handshakeDir : null,
      checks: r.checks,
      profiles: r.profiles ?? [],
      payloads: payloads as Record<string, string>,
      savingPayloads: r.savingPayloads ?? [],
      fakeRomm: r.fakeRomm ?? null,
      readOnlyServer: true,
      privacy: true,
      abortOnInput: r.abortOnInput !== false,
      screenshots: r.screenshots ?? []
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

// The pattern alone takes a month 13; Date.parse does not.
function isIsoTime(value: string): boolean {
  return ISO_TIME.test(value) && Number.isFinite(Date.parse(value))
}

export interface RunOptions {
  request: SelfTestRequest
  scenarios: ReadonlyMap<string, Scenario>
  guard: ReadOnlyGuard
  version: string
  device?: Summary['device']
  power?: Summary['power']
  /** Set by input from the real controller. See `RUN_CHECKS`. */
  signal?: AbortSignal
  /** Captures the request's `screenshots`, after every check. See `takeScreenshots`. */
  screenshots?: (screens: readonly string[], signal: AbortSignal) => Promise<ShotsOutcome>
  now?: () => number
}

/**
 * Run every requested check and say how it went.
 *
 * Never throws: a scenario that throws is that check's `error`, and the run
 * goes on to the next, because the summary is the only thing the bridge
 * publishes and one broken scenario must not hide what the others measured.
 * A run cut short by the budget or a crash is `partial`; one stopped by the
 * player is `aborted-by-user`, which flips nothing.
 */
export async function runSelfTest(options: RunOptions): Promise<Summary> {
  const { request, scenarios, guard } = options
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const started = now()
  const deadline = Math.min(
    started + request.budgetSeconds * 1000,
    request.deadline === null ? Infinity : Date.parse(request.deadline)
  )
  const safety: Safety = {
    serverWritesAttempted: 0,
    deviceIdOnSaveRequests: 0,
    ownerStateChanged: [],
    romsDownloadedBytes: 0,
    romsLeft: 0
  }
  const checks: CheckResult[] = []
  const notes: string[] = []
  let partial = false
  const run = new Set<string>(Object.values(RUN_CHECKS))

  for (const id of new Set(request.checks)) {
    if (run.has(id)) continue
    if (signal.aborted) {
      checks.push(skipped(id, SKIP.aborted))
      continue
    }
    if (now() >= deadline) {
      partial = true
      checks.push(skipped(id, SKIP.budget))
      continue
    }
    const scenario = scenarios.get(id)
    if (!scenario) {
      // Not "every requested check ran", which is what `complete` says.
      partial = true
      checks.push(skipped(id, SKIP.notImplemented))
      continue
    }
    try {
      const answered = await scenario({ request, safety, signal })
      checks.push(...(Array.isArray(answered) ? answered : [answered]))
    } catch (cause) {
      // Only logged: an error's message can carry the server's address or a
      // title from the library, and the summary is published.
      log.warn('selftest', 'a scenario threw', { id, cause })
      partial = true
      checks.push({ ...skipped(id, 'scenario-threw'), result: 'error' })
    }
  }

  const shots = await screenshots(options, signal, now() >= deadline)
  // As for checks: screens this build cannot take, or had no time or no
  // working capture for, are not "every requested check ran".
  if (shots.missing.some((m) => UNTAKEN.has(m.slice(m.lastIndexOf(':') + 1)))) partial = true
  for (const missing of shots.missing) notes.push(`screenshot ${missing}`)

  safety.serverWritesAttempted = guard.serverWritesAttempted
  checks.push(serverReadOnly(guard))
  if (request.checks.includes(RUN_CHECKS.complete)) checks.push(complete(checks, shots))
  if (signal.aborted) notes.push('stopped by input from the controller')

  return {
    schema: 1,
    sha: request.sha,
    version: options.version,
    status: signal.aborted ? 'aborted-by-user' : partial ? 'partial' : 'complete',
    reason: null,
    startedAt: iso(started),
    finishedAt: iso(now()),
    device: options.device ?? {},
    power: options.power ?? {},
    safety,
    checks,
    notes
  }
}

/**
 * Run on every run, requested or not: the read-only guard is what makes a
 * self-test against the owner's server safe at all, so each summary says
 * whether anything tried to get past it. A refused write never left the
 * device, but it is still a code path that would have written, so it fails.
 */
function serverReadOnly(guard: ReadOnlyGuard): CheckResult {
  const attempted = guard.serverWritesAttempted
  return {
    id: RUN_CHECKS.serverReadOnly,
    result: attempted === 0 ? 'pass' : 'fail',
    metrics: {
      serverWritesAttempted: attempted,
      deviceIdsRemoved: guard.deviceIdsRemoved,
      deviceIdOnSaveRequests: 0
    },
    thresholds: { serverWritesAttempted: 0 },
    reason: attempted === 0 ? null : 'write-refused',
    evidence: []
  }
}

const SHOTS_THREW = 'screenshots-threw'

/**
 * The request's screenshots, never throwing: a capture that breaks leaves its
 * screens missing, which `selftest.complete` answers for, and the summary is
 * still written.
 */
async function screenshots(
  options: RunOptions,
  signal: AbortSignal,
  overBudget: boolean
): Promise<ShotsOutcome> {
  const screens = [...new Set(options.request.screenshots)]
  const all = (code: string): ShotsOutcome => ({
    evidence: [],
    missing: screens.map((screen) => `${screen}:${code}`),
    withheld: []
  })
  if (screens.length === 0) return { evidence: [], missing: [], withheld: [] }
  if (signal.aborted) return all(SKIP.aborted)
  if (overBudget) return all(SKIP.budget)
  if (!options.screenshots) return all(SKIP.notImplemented)
  try {
    return await options.screenshots(screens, signal)
  } catch (cause) {
    log.warn('selftest', 'the screenshots threw', { cause })
    return all(SHOTS_THREW)
  }
}

/**
 * Passes only when every other requested check really ran and every requested
 * screen was captured: a check this build has no scenario for, or one that
 * threw or ran out of time, is not "the requested scenarios ran", even though
 * the summary itself is whole. A screen withheld for privacy was not asked
 * for in any sense the run could meet, so it is counted but not missed.
 */
function complete(checks: readonly CheckResult[], shots: ShotsOutcome): CheckResult {
  const missing = checks.filter(
    (c) => c.result === 'error' || (c.result === 'skip' && c.reason !== null && UNRUN.has(c.reason))
  )
  const pass = missing.length === 0 && shots.missing.length === 0
  return {
    id: RUN_CHECKS.complete,
    result: pass ? 'pass' : 'fail',
    metrics: {
      checks: checks.length,
      notRun: missing.length,
      screenshots: shots.evidence.length,
      screenshotsMissing: shots.missing.length,
      screenshotsWithheld: shots.withheld.length
    },
    thresholds: { notRun: 0, screenshotsMissing: 0 },
    reason: pass ? null : missing.length > 0 ? 'checks-not-run' : 'screenshots-missing',
    evidence: shots.evidence
  }
}

const UNRUN = new Set<string>(Object.values(SKIP))
const UNTAKEN = new Set<string>([SKIP.budget, SKIP.notImplemented, SHOTS_THREW])

function skipped(id: string, reason: string): CheckResult {
  return { id, result: 'skip', metrics: {}, thresholds: {}, reason, evidence: [] }
}

/**
 * Run, write the summary, and give the code to quit with: 0 once a summary is
 * on disk, whatever it says, since the checks in it carry the verdict; 1 only
 * when not even an error summary could be written.
 */
export async function runAndReport(options: RunOptions): Promise<number> {
  const { request } = options
  try {
    writeSummary(request.resultsDir, await runSelfTest(options))
    return 0
  } catch (cause) {
    log.error('selftest', 'the run could not report', cause)
  }
  try {
    const at = (options.now ?? Date.now)()
    writeSummary(request.resultsDir, errorSummary(request.sha, options.version, 'runner-threw', at))
  } catch (cause) {
    log.error('selftest', 'could not write even an error summary', cause)
  }
  return 1
}

/**
 * Say why a request was refused, where the harness will look for it. A
 * request too broken to name its results folder leaves only the log, and the
 * bridge reports the missing summary itself.
 */
export function reportRefusal(
  refused: Extract<Taken, { kind: 'refused' }>,
  version: string,
  now = Date.now()
): void {
  log.warn('selftest', 'refused the request', { reason: refused.reason })
  if (!refused.resultsDir) return
  try {
    writeSummary(refused.resultsDir, errorSummary(refused.sha, version, refused.reason, now))
  } catch (cause) {
    log.error('selftest', 'could not write the refusal', cause)
  }
}

/** The summary for a request that was refused or a runner that failed. */
export function errorSummary(
  sha: string | null,
  version: string,
  reason: string,
  at: number
): Summary {
  return {
    schema: 1,
    sha: sha ?? '0'.repeat(40),
    version,
    status: 'error',
    reason,
    startedAt: iso(at),
    finishedAt: iso(at),
    device: {},
    power: {},
    safety: {
      serverWritesAttempted: 0,
      deviceIdOnSaveRequests: 0,
      ownerStateChanged: [],
      romsDownloadedBytes: 0,
      romsLeft: 0
    },
    checks: [],
    notes: []
  }
}

/**
 * Write the summary whole or not at all: the bridge reads it the moment the
 * app exits, and half a file reads as a run that never reported.
 */
export function writeSummary(resultsDir: string, summary: Summary): void {
  mkdirSync(resultsDir, { recursive: true })
  const tmp = join(resultsDir, `.${SUMMARY_FILE}.tmp`)
  writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`)
  renameSync(tmp, join(resultsDir, SUMMARY_FILE))
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const CHECK_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+(@[a-z0-9-]+)?$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/**
 * Where a summary departs from the schema in docs/TESTING.md, or nothing.
 * The agent's ingestion trusts these fields, so the self-test's own output is
 * held to them in tests rather than discovered wrong on the device.
 */
export function summaryErrors(value: unknown): string[] {
  const errors: string[] = []
  const s = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const need = (ok: boolean, what: string): void => {
    if (!ok) errors.push(what)
  }
  need(s.schema === 1, 'schema')
  need(typeof s.sha === 'string' && SHA.test(s.sha), 'sha')
  need(typeof s.version === 'string' && s.version !== '', 'version')
  need(STATUSES.includes(s.status as Status), 'status')
  need(s.reason === null || typeof s.reason === 'string', 'reason')
  need(typeof s.startedAt === 'string' && ISO_TIME.test(s.startedAt), 'startedAt')
  need(typeof s.finishedAt === 'string' && ISO_TIME.test(s.finishedAt), 'finishedAt')
  need(isRecord(s.device), 'device')
  need(isRecord(s.power), 'power')
  const safety = isRecord(s.safety) ? s.safety : null
  need(safety !== null, 'safety')
  if (safety) {
    for (const key of [
      'serverWritesAttempted',
      'deviceIdOnSaveRequests',
      'romsDownloadedBytes',
      'romsLeft'
    ]) {
      need(Number.isInteger(safety[key]) && (safety[key] as number) >= 0, `safety.${key}`)
    }
    need(isStringArray(safety.ownerStateChanged), 'safety.ownerStateChanged')
  }
  need(isStringArray(s.notes), 'notes')
  need(Array.isArray(s.checks), 'checks')
  for (const [i, raw] of (Array.isArray(s.checks) ? s.checks : []).entries()) {
    const c = (isRecord(raw) ? raw : {}) as Record<string, unknown>
    const at = `checks[${i}]`
    need(typeof c.id === 'string' && CHECK_ID.test(c.id), `${at}.id`)
    need(RESULTS.includes(c.result as Result), `${at}.result`)
    need(
      isRecord(c.metrics) &&
        Object.values(c.metrics).every(
          (m) =>
            m === null || typeof m === 'string' || (typeof m === 'number' && Number.isFinite(m))
        ),
      `${at}.metrics`
    )
    need(
      isRecord(c.thresholds) &&
        Object.values(c.thresholds).every((m) => typeof m === 'number' && Number.isFinite(m)),
      `${at}.thresholds`
    )
    need(c.reason === null || typeof c.reason === 'string', `${at}.reason`)
    need(c.result !== 'skip' || typeof c.reason === 'string', `${at}.reason (a skip says why)`)
    need(
      isStringArray(c.evidence) &&
        c.evidence.every((p) => !isAbsolute(p) && !p.split(/[\\/]/).includes('..')),
      `${at}.evidence`
    )
  }
  return errors
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
