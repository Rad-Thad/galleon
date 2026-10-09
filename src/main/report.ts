import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redact } from './redact.ts'
import { zipDirectory } from './zip.ts'
import { log } from './log.ts'

/**
 * Report a problem: one zip with what someone looking at a fault on this
 * device would otherwise have to ask for, one question at a time.
 *
 * Written into the root's `reports/` folder and nowhere else; nothing is sent.
 * Everything that goes in is text, and every byte of it passes through
 * `redact` on the way, so the report can be handed over without anyone first
 * reading it for the server's address or a token. Credentials are not
 * redacted but never read: nothing under `config/` goes in except the
 * settings file, which holds no secrets and is redacted all the same.
 *
 * What only the running application knows (pre-flight results, emulator
 * probes, the power state) arrives as `sections`, so this module stays
 * testable against a folder and the collectors stay where their code is.
 */

/** Where the logs this reads live, inside the root. */
const LOGS_DIR = 'logs'
const LOG_FILES = ['app.log', 'launcher.log']

/**
 * How much of each log goes in, from its end.
 *
 * The end is where the fault is; the start of a long log is old sessions. The
 * cap is what keeps a report small enough to attach anywhere whatever the
 * logs have grown to (see `REPORT_LIMIT`).
 */
export const LOG_TAIL_BYTES = 4 * 1024 * 1024

/** The size a report must stay under, uncompressed logs included. */
export const REPORT_LIMIT = 20 * 1024 * 1024

/** How many launches, each with what followed it, the report recounts. */
export const LAUNCHES = 5

/** How many per-screen frame summaries the report keeps. */
export const PERF_SUMMARIES = 20

/**
 * Environment variables worth knowing about, by prefix or name. A list of
 * what to take rather than of what to leave, so a variable nobody thought of
 * (a token in `CI_JOB_TOKEN`, a proxy with a password) stays out.
 */
const ENV_PREFIXES = [
  'GALLEON_',
  'ROMMIX_',
  'XDG_',
  'SDL_',
  'MESA_',
  'GAMESCOPE',
  'STEAM_',
  'SteamDeck',
  'SteamGamepadUI',
  'LC_'
]
const ENV_NAMES = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'LANG',
  'LANGUAGE',
  'DESKTOP_SESSION',
  'APPIMAGE',
  'ELECTRON_OZONE_PLATFORM_HINT'
]
const ENV_SECRET = /token|password|passwd|secret|key|cookie|credential|auth/i

export interface ReportInput {
  /** The Galleon root (see `rootPaths`). */
  root: string
  /** The configured RomM base URL, so its host is redacted everywhere. */
  serverUrl: string | null
  /** App, commit, channel, Electron and Chromium versions. */
  versions: Record<string, unknown>
  /** Each becomes `<name>.json`. A section that throws is recorded as its error. */
  sections?: Record<string, () => unknown>
  env?: NodeJS.ProcessEnv
  /** Where `/etc/os-release` and `/proc` are, for tests. */
  systemRoot?: string
  now?: Date
}

/** The last `bytes` of a file, starting at a whole line, or null if unreadable. */
export async function tail(path: string, bytes: number): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    if (start === 0) return text
    const newline = text.indexOf('\n')
    return newline === -1 ? text : text.slice(newline + 1)
  } finally {
    await handle.close()
  }
}

/** A log line's area, the column after the level. */
function area(line: string): string | undefined {
  return /^\S+ \S+\s+(\S+)/.exec(line)?.[1]
}

/**
 * The last `LAUNCHES` launches from the app log: each `launch starting` line
 * and every launch or emulator line after it, so a command sits beside its exit.
 */
export function launches(appLog: string): string[] {
  const lines = appLog.split('\n')
  const starts = lines.flatMap((line, index) =>
    area(line) === 'launch' && / starting( |$)/.test(line) ? [index] : []
  )
  if (starts.length === 0) return []
  const from = starts[Math.max(0, starts.length - LAUNCHES)]
  return lines.slice(from).filter((line) => {
    const which = area(line)
    return which === 'launch' || which === 'emulator'
  })
}

/** The last `PERF_SUMMARIES` per-screen frame summaries from the app log. */
export function perfSummaries(appLog: string): string[] {
  return appLog
    .split('\n')
    .filter((line) => line.includes(' perf summary '))
    .slice(-PERF_SUMMARIES)
}

/** The variables `ENV_PREFIXES` and `ENV_NAMES` take, secrets by name left out. */
export function environment(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env).toSorted(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined || ENV_SECRET.test(name)) continue
    if (ENV_NAMES.includes(name) || ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      out[name] = value
    }
  }
  return out
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** `2026-10-09T16-27-01Z`: sortable, and a legal file name everywhere. */
export function reportName(now: Date): string {
  return `${now
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/:/g, '-')}.zip`
}

/**
 * Write the report and return its path.
 *
 * Assembled in a folder beside where it will land and zipped from there, so a
 * report that fails half-way leaves no half-written zip under a real name.
 */
export async function writeReport(input: ReportInput): Promise<string> {
  const now = input.now ?? new Date()
  const reports = join(input.root, 'reports')
  await mkdir(reports, { recursive: true })
  const staging = await mkdtemp(join(reports, '.staging-'))
  const clean = (text: string): string => redact(text, { serverUrl: input.serverUrl })
  const put = async (name: string, text: string): Promise<void> => {
    await mkdir(join(staging, name, '..'), { recursive: true })
    await writeFile(join(staging, name), clean(text))
  }
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

  try {
    let appLog = ''
    for (const file of LOG_FILES) {
      const text = await tail(join(input.root, LOGS_DIR, file), LOG_TAIL_BYTES)
      if (text === null) continue
      if (file === 'app.log') appLog = text
      await put(`logs/${file}`, text)
    }
    await put('launches.log', launches(appLog).join('\n'))
    await put('perf.log', perfSummaries(appLog).join('\n'))

    const settings = await readText(join(input.root, 'config', 'settings.json'))
    if (settings !== null) await put('settings.json', settings)

    await put('versions.json', json(input.versions))
    const system = input.systemRoot ?? '/'
    await put(
      'system.json',
      json({
        osRelease: await readText(join(system, 'etc/os-release')),
        kernel: (await readText(join(system, 'proc/sys/kernel/osrelease')))?.trim() ?? null,
        platform: process.platform,
        arch: process.arch
      })
    )
    await put('environment.json', json(environment(input.env ?? process.env)))

    for (const [name, collect] of Object.entries(input.sections ?? {})) {
      let value: unknown
      try {
        value = await collect()
      } catch (cause) {
        value = { error: (cause as Error).message ?? String(cause) }
      }
      await put(`${name}.json`, json(value ?? null))
    }

    const path = join(reports, reportName(now))
    await zipDirectory(staging, path)
    const { size } = await stat(path)
    log.info('report', 'report written', { path, bytes: size })
    return path
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
