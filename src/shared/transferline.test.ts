import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createI18n, type Locale } from './i18n/index.ts'
import { transferLine } from './transferline.ts'
import { startRate, type TransferRate } from './transferrate.ts'

const MB = 1024 * 1024

/** A rate as `sampleRate` would leave it, without running a transfer for it. */
function rate(fields: Partial<TransferRate>): TransferRate {
  return { ...startRate(0, 0), ...fields }
}

const moving = rate({ speed: 41.4 * MB, speedUnit: 2, secondsLeft: 80, timeUnit: 1 })

/** The non-breaking spaces `Intl` puts before a percent sign, as plain ones. */
function line(locale: Locale, received: number, total: number, r: TransferRate | null): string {
  return transferLine(createI18n(locale), received, total, r).replace(/[  ]/g, ' ')
}

describe('transfer line', () => {
  test('reads as percent, size, speed and time left in all four languages', () => {
    const expected: Record<Locale, string> = {
      en: '15% - 613.6 MB / 3.8 GB - 41.4 MB/s - 1m 20s left',
      fr: '15 % - 613,6 MB / 3,8 GB - 41,4 MB/s - encore 1 min 20 s',
      de: '15 % - 613,6 MB / 3,8 GB - 41,4 MB/s - noch 1 Min. 20 Sek.',
      es: '15 % - 613,6 MB / 3,8 GB - 41,4 MB/s - quedan 1 min 20 s'
    }
    for (const [locale, text] of Object.entries(expected) as [Locale, string][]) {
      assert.equal(line(locale, 613.6 * MB, 3.8 * 1024 * MB, moving), text)
    }
  })

  test('time left in seconds and in hours', () => {
    assert.equal(
      line('en', 900 * MB, 1000 * MB, rate({ speed: 2 * MB, speedUnit: 2, secondsLeft: 50 })),
      '90% - 900.0 MB / 1,000.0 MB - 2.0 MB/s - 50s left'
    )
    assert.equal(
      line('de', 5000, 9000, rate({ speed: 900, secondsLeft: 5000, timeUnit: 2 })),
      '55 % - 4,9 KB / 8,8 KB - 900 B/s - noch 1 Std. 23 Min.'
    )
  })

  test('the speed is shown in the unit the rate settled on', () => {
    // 0.93 MB/s kept in MB/s by the hysteresis, not turned into 952.3 KB/s.
    const r = rate({ speed: 0.93 * MB, speedUnit: 2, secondsLeft: 10 })
    assert.equal(line('en', 10 * MB, 20 * MB, r), '50% - 10.0 MB / 20.0 MB - 0.9 MB/s - 10s left')
  })

  test('never 100% before the last byte', () => {
    assert.match(line('en', 999 * MB, 1000 * MB, moving), /^99% /)
  })

  test('before the first byte it is waiting for the server', () => {
    const expected: Record<Locale, string> = {
      en: '0% - 0 B / 3.8 GB - waiting for server',
      fr: '0 % - 0 B / 3,8 GB - en attente du serveur',
      de: '0 % - 0 B / 3,8 GB - wartet auf den Server',
      es: '0 % - 0 B / 3,8 GB - esperando al servidor'
    }
    for (const [locale, text] of Object.entries(expected) as [Locale, string][]) {
      assert.equal(line(locale, 0, 3.8 * 1024 * MB, startRate(0, 0)), text)
      assert.equal(line(locale, 0, 3.8 * 1024 * MB, null), text)
    }
  })

  test('a stall says so, with no time left', () => {
    const stalled = rate({ ...moving, stalled: true, secondsLeft: null })
    const expected: Record<Locale, string> = {
      en: '50% - 1.0 MB / 2.0 MB - stalled',
      fr: '50 % - 1,0 MB / 2,0 MB - bloqué',
      de: '50 % - 1,0 MB / 2,0 MB - stockt',
      es: '50 % - 1,0 MB / 2,0 MB - detenida'
    }
    for (const [locale, text] of Object.entries(expected) as [Locale, string][]) {
      assert.equal(line(locale, MB, 2 * MB, stalled), text)
    }
  })

  test('without a size, only what has arrived', () => {
    assert.equal(line('en', 5 * MB, 0, rate({ speed: MB, speedUnit: 2 })), '5.0 MB - 1.0 MB/s')
  })
})
