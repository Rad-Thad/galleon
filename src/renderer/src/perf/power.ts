import type { I18n } from '@shared/i18n'
import type { PowerState } from '@shared/types'

/**
 * The power state as lines of text, shared by the performance overlay and
 * the pre-flight check so the two never describe the same clocks differently.
 * A value the machine would not give reads as the catalogue's "unknown".
 */
export function powerLines(
  t: I18n['t'],
  power: PowerState
): { cpu: string; gpu: string; profile: string } {
  const word = (value: string): string => (value === 'unknown' ? t('perf.unknown') : value)
  const mhz = (value: number | null, perMhz: number): string =>
    value === null ? t('perf.unknown') : String(Math.round(value / perMhz))
  return {
    cpu: t('perf.cpu', {
      governor: word(power.cpuGovernor),
      cur: mhz(power.cpuCurKHz, 1000),
      max: mhz(power.cpuMaxKHz, 1000)
    }),
    gpu: t('perf.gpu', {
      governor: word(power.gpuGovernor),
      cur: mhz(power.gpuCurHz, 1_000_000),
      max: mhz(power.gpuMaxHz, 1_000_000)
    }),
    profile: t('perf.profile', {
      profile: word(power.profile),
      start: word(power.defaultProfile)
    })
  }
}
