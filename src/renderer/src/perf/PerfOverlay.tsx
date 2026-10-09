import { type JSX, useEffect, useRef, useState } from 'react'
import type { PerfState } from '@shared/types'
import { useI18n } from '../state'
import { type FrameStats, FrameWindow } from './frames'

/**
 * The performance overlay: frame times for the screen on display and the
 * power state they were measured under, in a corner.
 *
 * Fixed in place and blind to the pointer, so turning it on moves nothing
 * under it and the screen measured is the screen as it is without it. The
 * frames are counted only while it is mounted, which is what makes it free
 * when it is off.
 */

/** The recent frames the numbers on screen describe. */
const DISPLAY_FRAMES = 240
/**
 * The most a per-screen summary covers. Bounded so a screen left open for
 * hours cannot grow without limit; the most recent frames are the ones kept.
 */
const SUMMARY_FRAMES = 36_000
/** How often the numbers are redrawn. Redrawing them every frame would be most of the cost. */
const REFRESH_MS = 500
/** How often the power state is read again, since Steam may change it at any time. */
const POWER_POLL_MS = 2000
/** Assumed until the main process has said, so the first redraw is not blank. */
const FALLBACK_HZ = 60

/** Rounded for reading: a tenth of a millisecond is finer than anyone can feel. */
const tenth = (value: number): number => Math.round(value * 10) / 10

/** One screen's summary, sent to the log if any frames were drawn on it. */
function report(screen: string, stats: FrameStats | null): void {
  if (!stats) return
  void window.rommix.system.perfSummary({ screen, ...stats }).catch(() => {
    // Reported centrally on `app:error`.
  })
}

export function PerfOverlay({ screen }: { screen: string }): JSX.Element {
  const { t } = useI18n()
  const [stats, setStats] = useState<FrameStats | null>(null)
  const [perf, setPerf] = useState<PerfState | null>(null)
  const hz = useRef(FALLBACK_HZ)
  // Made once and kept: the windows are mutated every frame, never rendered.
  const [recent] = useState(() => new FrameWindow(DISPLAY_FRAMES))
  const [summary] = useState(() => new FrameWindow(SUMMARY_FRAMES))
  const screenRef = useRef(screen)

  useEffect(() => {
    let frame = 0
    const tick = (timestamp: number): void => {
      recent.tick(timestamp)
      summary.tick(timestamp)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const redraw = window.setInterval(() => setStats(recent.stats(hz.current)), REFRESH_MS)

    // A hidden window draws no frames, and the wait until it is shown again is
    // not a frame anybody waited for: the screen's summary ends there.
    const onVisibility = (): void => {
      if (document.visibilityState !== 'hidden') return
      report(screenRef.current, summary.stats(hz.current))
      summary.reset()
      recent.reset()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(redraw)
      document.removeEventListener('visibilitychange', onVisibility)
      report(screenRef.current, summary.stats(hz.current))
    }
  }, [recent, summary])

  useEffect(() => {
    let live = true
    const read = (): void => {
      void window.rommix.system
        .perfState()
        .then((next) => {
          if (!live) return
          hz.current = next.displayHz
          setPerf(next)
        })
        .catch(() => {
          // Reported centrally on `app:error`.
        })
    }
    read()
    const timer = window.setInterval(read, POWER_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  // Each screen gets a summary of its own, so a slow screen is named rather
  // than averaged into the fast ones around it.
  useEffect(() => {
    if (screenRef.current === screen) return
    report(screenRef.current, summary.stats(hz.current))
    summary.reset()
    recent.reset()
    screenRef.current = screen
    setStats(null)
  }, [screen, recent, summary])

  const word = (value: string): string => (value === 'unknown' ? t('perf.unknown') : value)
  const mhz = (value: number | null, perMhz: number): string =>
    value === null ? t('perf.unknown') : String(Math.round(value / perMhz))
  const power = perf?.power

  return (
    <aside className="perf-overlay" aria-hidden="true" data-perf-overlay>
      <div>{t('perf.screen', { screen })}</div>
      {stats ? (
        <>
          <div>
            {t('perf.frameTimes', {
              p50: tenth(stats.p50),
              p90: tenth(stats.p90),
              p99: tenth(stats.p99)
            })}
          </div>
          <div>
            {t('perf.janky', { pct: tenth(stats.jankyPct), hz: perf?.displayHz ?? FALLBACK_HZ })}
          </div>
        </>
      ) : (
        <div>{t('perf.measuring')}</div>
      )}
      {power && (
        <>
          <div>
            {t('perf.cpu', {
              governor: word(power.cpuGovernor),
              cur: mhz(power.cpuCurKHz, 1000),
              max: mhz(power.cpuMaxKHz, 1000)
            })}
          </div>
          <div>
            {t('perf.gpu', {
              governor: word(power.gpuGovernor),
              cur: mhz(power.gpuCurHz, 1_000_000),
              max: mhz(power.gpuMaxHz, 1_000_000)
            })}
          </div>
          <div>{t('perf.defaultProfile', { profile: word(power.defaultProfile) })}</div>
        </>
      )}
    </aside>
  )
}
