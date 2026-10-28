import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PowerState } from '@shared/types'
import { SKIP, type CheckResult, type Scenario } from './selftest.ts'
import type { ProfileAnswer } from './selftestscroll.ts'
import { parseArmadaStatus, parseNumber, parseWord, UNKNOWN } from './powerstate.ts'

/**
 * `power.read`: what Galleon reads of the power state, held against what
 * Armada and the kernel say, on each power profile the request names.
 *
 * Galleon names the profile by inference from the clocks (`profileInForce`),
 * since the overlay cannot start `armada-power` every few frames, so the
 * check is whether that inference agrees with the daemon that switched the
 * profile. The governors and caps are checked against sysfs found afresh
 * here, the prime cluster as the highest-numbered cpufreq policy and the GPU
 * as any devfreq device named for one, so a reader that looked in the wrong
 * place fails rather than agreeing with itself.
 */

export const POWER_READ_CHECK = 'power.read'

/** The kernel's own view, as found by this check rather than by `readPowerState`. */
export interface SysfsPower {
  cpuGovernor: string
  cpuMaxKHz: number | null
  gpuGovernor: string
  gpuMaxHz: number | null
}

export interface PowerReadDeps {
  /** Galleon's reading, without `armada-power status`. */
  power: () => Promise<PowerState>
  /** `armada-power status`'s output, or null when it did not answer. */
  status: () => Promise<string | null>
  sysfs: () => Promise<SysfsPower>
  askForProfile: (profile: string, signal: AbortSignal) => Promise<ProfileAnswer>
}

/** The prime cluster's cap in `cpu_caps`, a Python dict keyed by policy or core. */
export function statusCap(status: string | null): number | null {
  const line = (status ?? '').split('\n').find((l) => /^\s*cpu_caps\s*=/.test(l))
  const match = /(?:^|[{,\s])['"]?(?:policy)?7['"]?\s*:\s*(\d+)/.exec(line ?? '')
  return match ? Number(match[1]) : null
}

/** One profile's comparison: what disagreed, and the values behind it. */
export function compare(
  wanted: string | null,
  galleon: PowerState,
  status: string | null,
  sysfs: SysfsPower
): { mismatches: string[]; metrics: CheckResult['metrics'] } {
  const said = parseArmadaStatus(status).toLowerCase()
  const inferred = galleon.profile.toLowerCase()
  const cap = statusCap(status)
  const mismatches: string[] = []
  if (said === UNKNOWN) mismatches.push('no-status')
  else if (inferred !== said) mismatches.push('profile')
  if (wanted !== null && said !== UNKNOWN && said !== wanted) mismatches.push('profile-set')
  if (galleon.cpuGovernor === UNKNOWN || galleon.cpuGovernor !== sysfs.cpuGovernor)
    mismatches.push('cpu-governor')
  if (galleon.cpuMaxKHz === null || galleon.cpuMaxKHz !== sysfs.cpuMaxKHz)
    mismatches.push('cpu-max')
  if (cap !== null && cap !== galleon.cpuMaxKHz) mismatches.push('cpu-cap')
  if (
    galleon.cpuCurKHz === null ||
    (galleon.cpuMaxKHz !== null && galleon.cpuCurKHz > galleon.cpuMaxKHz)
  )
    mismatches.push('cpu-cur')
  if (galleon.gpuGovernor === UNKNOWN || galleon.gpuGovernor !== sysfs.gpuGovernor)
    mismatches.push('gpu-governor')
  if (galleon.gpuMaxHz === null || galleon.gpuMaxHz !== sysfs.gpuMaxHz) mismatches.push('gpu-max')
  if (galleon.gpuCurHz === null) mismatches.push('gpu-cur')
  return {
    mismatches,
    metrics: {
      profile: inferred,
      statusProfile: said,
      cpuGovernor: galleon.cpuGovernor,
      sysfsCpuGovernor: sysfs.cpuGovernor,
      cpuMaxKHz: galleon.cpuMaxKHz,
      sysfsCpuMaxKHz: sysfs.cpuMaxKHz,
      statusCapKHz: cap,
      cpuCurKHz: galleon.cpuCurKHz,
      gpuGovernor: galleon.gpuGovernor,
      sysfsGpuGovernor: sysfs.gpuGovernor,
      gpuMaxMHz: galleon.gpuMaxHz === null ? null : Math.round(galleon.gpuMaxHz / 1e6),
      sysfsGpuMaxMHz: sysfs.gpuMaxHz === null ? null : Math.round(sysfs.gpuMaxHz / 1e6),
      gpuCurMHz: galleon.gpuCurHz === null ? null : Math.round(galleon.gpuCurHz / 1e6)
    }
  }
}

/**
 * Passes when every profile named agrees throughout; with none named, the
 * profile in force is checked. Off Armada, where `armada-power` does not
 * answer and no profile definition is read, it is `skip` / `not-armada`. A
 * profile run.sh could not put in force is `skip` / `profile-not-set`, unless
 * another already disagreed.
 */
export function powerReadScenario(deps: PowerReadDeps): Scenario {
  return async ({ request, signal }) => {
    const result = (
      verdict: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics']
    ): CheckResult => ({
      id: POWER_READ_CHECK,
      result: verdict,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    const first = await deps.status()
    const before = await deps.power()
    if (first === null && before.defaultProfile === UNKNOWN) return result('skip', 'not-armada', {})

    const wanted = request.profiles.length ? request.profiles.map((p) => p.toLowerCase()) : [null]
    const metrics: CheckResult['metrics'] = {}
    const failed: string[] = []
    const notSet: string[] = []
    for (const profile of wanted) {
      if (signal.aborted) return result('skip', SKIP.aborted, metrics)
      const prefix = profile === null ? '' : `${profile}.`
      if (profile !== null) {
        const now = parseArmadaStatus(await deps.status()).toLowerCase()
        if (now !== profile) {
          const answer = await deps.askForProfile(profile, signal)
          const after = parseArmadaStatus(await deps.status()).toLowerCase()
          if (after !== profile) {
            metrics[`${prefix}profileObserved`] = after
            metrics[`${prefix}profileAnswer`] = answer
            notSet.push(profile)
            continue
          }
        }
      }
      // Galleon's reading sits between the two references, so a clock that
      // moves between reads cannot pass on one and fail on the other.
      const status = await deps.status()
      const galleon = await deps.power()
      const sysfs = await deps.sysfs()
      const checked = compare(profile, galleon, status, sysfs)
      for (const [key, value] of Object.entries(checked.metrics)) metrics[prefix + key] = value
      failed.push(...checked.mismatches.map((m) => (profile === null ? m : `${profile}:${m}`)))
    }
    if (failed.length) return result('fail', `mismatch:${failed.join(',')}`, metrics)
    if (notSet.length) return result('skip', 'profile-not-set', metrics)
    return result('pass', null, metrics)
  }
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

const CPUFREQ = 'sys/devices/system/cpu/cpufreq'
const DEVFREQ = 'sys/class/devfreq'

/** The kernel's power state, found without `readPowerState`'s paths. `root` is for tests. */
export async function readSysfsPower(root = '/'): Promise<SysfsPower> {
  const policies = (await readdir(join(root, CPUFREQ)).catch(() => [] as string[]))
    .map((name) => /^policy(\d+)$/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
  const prime = policies.length ? join(root, CPUFREQ, `policy${Math.max(...policies)}`) : null
  const gpu = (await readdir(join(root, DEVFREQ)).catch(() => [] as string[])).filter((name) =>
    /gpu/i.test(name)
  )
  // Two GPUs would leave nothing to compare against, which the check reports.
  const device = gpu.length === 1 ? join(root, DEVFREQ, gpu[0]) : null
  const cpuText = (name: string) => (prime ? readText(join(prime, name)) : Promise.resolve(null))
  const gpuText = (name: string) => (device ? readText(join(device, name)) : Promise.resolve(null))
  return {
    cpuGovernor: parseWord(await cpuText('scaling_governor')),
    cpuMaxKHz: parseNumber(await cpuText('scaling_max_freq')),
    gpuGovernor: parseWord(await gpuText('governor')),
    gpuMaxHz: parseNumber(await gpuText('max_freq'))
  }
}
