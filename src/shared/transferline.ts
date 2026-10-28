import type { I18n } from './i18n/index.ts'
import { SPEED_UNITS, type TransferRate } from './transferrate.ts'

/**
 * One download row's progress as a line: how far, how much, how fast and how
 * long.
 *
 * The sizes carry a decimal at every unit above bytes, unlike `formatBytes`:
 * a transfer is watched while it moves, and a size that only changes every
 * few seconds reads as stuck.
 */
export function transferLine(
  i18n: I18n,
  received: number,
  total: number,
  rate: TransferRate | null
): string {
  const fixed = decimals(i18n.locale)
  const parts: string[] = []
  if (total > 0) {
    // Down, never up: "100%" belongs to a transfer that is done.
    parts.push(percent(i18n.locale).format(Math.floor((received / total) * 100) / 100))
    parts.push(`${size(received, fixed)} / ${size(total, fixed)}`)
  } else {
    parts.push(size(received, fixed))
  }

  if (received === 0 && !rate?.stalled) {
    // Nothing yet is RomM still building the file to send: a zip of a large
    // game takes a while before its first byte.
    parts.push(i18n.t('downloads.waitingForServer'))
  } else if (rate?.stalled) {
    parts.push(i18n.t('downloads.stalled'))
  } else if (rate?.speed) {
    parts.push(`${inUnit(rate.speed, rate.speedUnit, fixed)}/s`)
    if (rate.secondsLeft !== null) parts.push(timeLeft(i18n, rate.secondsLeft, rate.timeUnit))
  }
  return parts.join(' - ')
}

function timeLeft(i18n: I18n, seconds: number, unit: TransferRate['timeUnit']): string {
  if (unit === 0) return i18n.t('downloads.leftSeconds', { seconds })
  if (unit === 1) {
    return i18n.t('downloads.leftMinutes', {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60
    })
  }
  return i18n.t('downloads.leftHours', {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60)
  })
}

function size(bytes: number, fixed: Intl.NumberFormat): string {
  let unit = 0
  while (unit < SPEED_UNITS.length - 1 && bytes >= 1024 ** (unit + 1)) unit++
  return inUnit(bytes, unit, fixed)
}

function inUnit(bytes: number, unit: number, fixed: Intl.NumberFormat): string {
  const value = bytes / 1024 ** unit
  return `${unit === 0 ? Math.round(value) : fixed.format(value)} ${SPEED_UNITS[unit]}`
}

const FORMATS = new Map<string, { decimals: Intl.NumberFormat; percent: Intl.NumberFormat }>()

function formats(locale: string): { decimals: Intl.NumberFormat; percent: Intl.NumberFormat } {
  let cached = FORMATS.get(locale)
  if (!cached) {
    cached = {
      decimals: new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }),
      percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
    }
    FORMATS.set(locale, cached)
  }
  return cached
}

const decimals = (locale: string): Intl.NumberFormat => formats(locale).decimals
const percent = (locale: string): Intl.NumberFormat => formats(locale).percent
