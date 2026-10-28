import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PowerState } from '@shared/types'

/**
 * What the machine's power management is doing right now, for the
 * performance overlay and the per-screen frame summary.
 *
 * On the Nova the power profile decides whether the interface feels smooth
 * (docs/DEVICE-FACTS.md, "Power profiles drive UI smoothness"), and Steam may
 * switch it behind Galleon's back, so a frame-time number means little
 * without the governor and clocks it was measured under. Everything here is
 * read from files any user may read; nothing needs root and nothing is
 * written. A value that cannot be read is `unknown` (or null for a number),
 * never a guess, so a desktop without these files shows that plainly.
 *
 * The parsers are pure and take the files' text, so they are tested against
 * fixtures; `readPowerState` only gathers that text.
 */

export type { PowerState }

export const UNKNOWN = 'unknown'

/** Armada's own report, which names the profile in force. See `readArmadaStatus`. */
const ARMADA_STATUS = ['armada-power', 'status'] as const

/** How long `armada-power status` is given before the answer is unknown. */
export const STATUS_TIMEOUT_MS = 3_000

/** The prime cluster, the one whose cap Armada's profiles move. */
const CPU_POLICY = 'sys/devices/system/cpu/cpufreq/policy7'
/** That cluster's cap in an `[underclock.<SoC>.<level>]` section of power-profiles.conf. */
const CPU_POLICY_CAP = 'cpu_max_policy7'
const DEVFREQ = 'sys/class/devfreq'
/** An edited copy in /etc wins over the factory file, as armada-powerd reads them. */
const PROFILE_CONFS = ['etc/armada/power-profiles.conf', 'usr/share/armada/power-profiles.conf']
/** Armada's perf contract: the cores, nice levels and scheduler it applies, in layers. */
const PERF_STATE = 'run/armada/perf-state.json'
/** The overlay is a corner, so a perf contract longer than this is cut short. */
const PERF_ENTRIES = 6

/** A sysfs word such as a governor name, or `unknown`. */
export function parseWord(text: string | null): string {
  const word = text?.trim().split(/\s+/)[0]
  return word ? word : UNKNOWN
}

/** A sysfs number, or null when the file held anything else. */
export function parseNumber(text: string | null): number | null {
  const trimmed = text?.trim() ?? ''
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/** `default_profile=<name>` from power-profiles.conf, or `unknown`. */
export function parseDefaultProfile(conf: string | null): string {
  const match = /^[ \t]*default_profile[ \t]*=[ \t]*["']?([A-Za-z0-9_-]+)/m.exec(conf ?? '')
  return match ? match[1] : UNKNOWN
}

/** power-profiles.conf's sections, each a map of its `key=value` lines. */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current = new Map<string, string>()
  sections.set('', current)
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      current = sections.get(header[1]) ?? new Map<string, string>()
      sections.set(header[1], current)
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  return sections
}

/**
 * The profile in force, by its label, or `unknown`.
 *
 * Armada keeps no file that says which profile is applied, so it is read off
 * the machine: a profile fits when its governor is the prime cluster's and
 * the cap its underclock level puts on that cluster (one per SoC in the
 * file) is the cluster's current maximum, or, for a profile without an
 * underclock, when no level's cap is. Only a single fit is named; two, or
 * none (a profile Steam or a person has tuned by hand), stay unknown.
 */
export function profileInForce(
  conf: string | null,
  cpuGovernor: string,
  cpuMaxKHz: number | null
): string {
  if (conf === null || cpuGovernor === UNKNOWN || cpuMaxKHz === null) return UNKNOWN
  const sections = parseIni(conf)
  const caps = new Map<string, Set<number>>()
  for (const [name, keys] of sections) {
    const level = /^underclock\.[^.]+\.(.+)$/.exec(name)?.[1]
    const cap = parseNumber(keys.get(CPU_POLICY_CAP) ?? null)
    if (level === undefined || cap === null) continue
    caps.set(level, (caps.get(level) ?? new Set<number>()).add(cap))
  }
  const anyCap = new Set([...caps.values()].flatMap((set) => [...set]))
  const fits: string[] = []
  for (const [name, keys] of sections) {
    const profile = /^profile\.(.+)$/.exec(name)?.[1]
    if (profile === undefined || keys.get('cpu_governor') !== cpuGovernor) continue
    const level = keys.get('cpu_underclock') ?? 'none'
    const capped =
      level === 'none' ? !anyCap.has(cpuMaxKHz) : (caps.get(level)?.has(cpuMaxKHz) ?? false)
    if (capped) fits.push(keys.get('label') || profile)
  }
  return fits.length === 1 ? fits[0] : UNKNOWN
}

/**
 * Armada's perf contract as `layer.key=value` entries, or `unknown`.
 *
 * Every scalar is listed under the path that holds it rather than picked out
 * by name: the device has shown only a `global` layer, and whatever else
 * Armada Control adds should appear as it is, not be guessed at.
 */
export function parsePerfState(text: string | null): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text ?? '')
  } catch {
    return UNKNOWN
  }
  const entries: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key)
    } else if (path) {
      entries.push(`${path}=${String(value)}`)
    }
  }
  walk(parsed, '')
  if (entries.length === 0) return UNKNOWN
  const shown = entries.slice(0, PERF_ENTRIES)
  return entries.length > shown.length ? `${shown.join(' ')} …` : shown.join(' ')
}

/**
 * The profile `armada-power status` names, or `unknown`.
 *
 * Its `key=value` lines come from the daemon that switched the profile, so
 * when it answers it is the authority `profileInForce` can only infer. Only a
 * plain word is taken: the value reaches published summaries.
 */
export function parseArmadaStatus(text: string | null): string {
  for (const line of (text ?? '').split('\n')) {
    const at = line.indexOf('=')
    if (at < 0 || line.slice(0, at).trim() !== 'profile') continue
    const value = line.slice(at + 1).trim()
    return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value) ? value : UNKNOWN
  }
  return UNKNOWN
}

/** The devfreq device that is the GPU: Adreno's is named after its address and `.gpu`. */
export function gpuDevice(names: readonly string[]): string | null {
  return names.toSorted().find((name) => /(^|[.-])gpu$/i.test(name)) ?? null
}

/** The text of every file `powerState` needs, null where a file could not be read. */
export interface PowerFiles {
  cpuGovernor: string | null
  cpuCur: string | null
  cpuMax: string | null
  gpuGovernor: string | null
  gpuCur: string | null
  gpuMax: string | null
  profileConf: string | null
  perfState: string | null
  /** `armada-power status`'s output, when it was asked. */
  armadaStatus?: string | null
}

export function powerState(files: PowerFiles): PowerState {
  const cpuGovernor = parseWord(files.cpuGovernor)
  const cpuMaxKHz = parseNumber(files.cpuMax)
  const said = parseArmadaStatus(files.armadaStatus ?? null)
  return {
    cpuGovernor,
    cpuCurKHz: parseNumber(files.cpuCur),
    cpuMaxKHz,
    gpuGovernor: parseWord(files.gpuGovernor),
    gpuCurHz: parseNumber(files.gpuCur),
    gpuMaxHz: parseNumber(files.gpuMax),
    profile: said !== UNKNOWN ? said : profileInForce(files.profileConf, cpuGovernor, cpuMaxKHz),
    defaultProfile: parseDefaultProfile(files.profileConf),
    perf: parsePerfState(files.perfState)
  }
}

/**
 * Where the power state is read from. `GALLEON_POWER_ROOT` stands a folder of
 * Armada's files in for `/`, for the app tests and screenshots, which run on
 * machines that are not armadaOS.
 */
export function powerRoot(): string {
  return process.env.GALLEON_POWER_ROOT?.trim() || '/'
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const execFileAsync = promisify(execFile)

/**
 * `armada-power status`, or null where there is none or it does not answer.
 * A read over D-Bus that needs no root (docs/DEVICE-FACTS.md), but a process
 * all the same, which is why only callers that can afford one ask for it.
 */
export async function readArmadaStatus(): Promise<string | null> {
  const [cmd, ...args] = ARMADA_STATUS
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: STATUS_TIMEOUT_MS })
    return stdout
  } catch {
    return null
  }
}

export interface PowerReadOptions {
  /**
   * Armada's own report, to name the profile rather than infer it. Left out
   * by the overlay, which reads this every few frames and must not start a
   * process each time.
   */
  status?: () => Promise<string | null>
}

/** The power state as this machine's files show it. `root` is for tests. */
export async function readPowerState(
  root = '/',
  options: PowerReadOptions = {}
): Promise<PowerState> {
  const cpu = join(root, CPU_POLICY)
  const devices = await readdir(join(root, DEVFREQ)).catch(() => [] as string[])
  const gpu = gpuDevice(devices)
  const gpuFile = (name: string) =>
    gpu === null ? Promise.resolve(null) : readText(join(root, DEVFREQ, gpu, name))
  let profileConf: string | null = null
  for (const conf of PROFILE_CONFS) {
    profileConf = await readText(join(root, conf))
    if (profileConf !== null) break
  }
  return powerState({
    cpuGovernor: await readText(join(cpu, 'scaling_governor')),
    cpuCur: await readText(join(cpu, 'scaling_cur_freq')),
    cpuMax: await readText(join(cpu, 'scaling_max_freq')),
    gpuGovernor: await gpuFile('governor'),
    gpuCur: await gpuFile('cur_freq'),
    gpuMax: await gpuFile('max_freq'),
    profileConf,
    perfState: await readText(join(root, PERF_STATE)),
    armadaStatus: options.status ? await options.status().catch(() => null) : null
  })
}
