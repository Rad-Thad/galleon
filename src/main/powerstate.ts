import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** The prime cluster, the one whose cap Armada's profiles move. */
const CPU_POLICY = 'sys/devices/system/cpu/cpufreq/policy7'
const DEVFREQ = 'sys/class/devfreq'
/** An edited copy in /etc wins over the factory file, as armada-powerd reads them. */
const PROFILE_CONFS = ['etc/armada/power-profiles.conf', 'usr/share/armada/power-profiles.conf']

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
}

export function powerState(files: PowerFiles): PowerState {
  return {
    cpuGovernor: parseWord(files.cpuGovernor),
    cpuCurKHz: parseNumber(files.cpuCur),
    cpuMaxKHz: parseNumber(files.cpuMax),
    gpuGovernor: parseWord(files.gpuGovernor),
    gpuCurHz: parseNumber(files.gpuCur),
    gpuMaxHz: parseNumber(files.gpuMax),
    defaultProfile: parseDefaultProfile(files.profileConf)
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** The power state as this machine's files show it. `root` is for tests. */
export async function readPowerState(root = '/'): Promise<PowerState> {
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
    profileConf
  })
}
