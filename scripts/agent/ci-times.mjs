#!/usr/bin/env node
//
// How long each required `build` leg takes on pull requests: the median wall
// time over the most recently merged ones, against the target in docs/PLAN.md
// section 4. A leg over the target makes fixing CI the next unit of work
// (CLAUDE.md, "Picking the next unit of work").
//
// `ci-times.mjs <pr>` prints one pull request's legs instead, for its
// PROGRESS.md entry (M0-18).
//
// Reads the check-runs API through `gh api`, the REST route that works from the
// cloud VM; changes nothing.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** The required checks, by the names the ruleset knows them by. */
export const LEGS = ['build (ubuntu-24.04, x64)', 'build (ubuntu-24.04-arm, arm64)']

/** The per-leg target, and how many pull requests the median is taken over. */
export const TARGET_MINUTES = 10
export const SAMPLE = 10

/** Minutes between two ISO timestamps. */
function minutes(start, end) {
  return (Date.parse(end) - Date.parse(start)) / 60_000
}

export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The wall time of each leg on one commit, from its check runs. Only a leg
 * that succeeded is timed: a failed one stops early and would flatter the
 * median, and a cancelled one says nothing about how long the work takes.
 */
export function legTimes(checkRuns) {
  const times = {}
  for (const run of checkRuns) {
    if (!LEGS.includes(run.name) || run.conclusion !== 'success') continue
    if (!run.started_at || !run.completed_at) continue
    times[run.name] = minutes(run.started_at, run.completed_at)
  }
  return times
}

/** The median per leg over the commits given, newest first, at most SAMPLE. */
export function summarise(perCommit) {
  return LEGS.map((leg) => {
    const values = perCommit
      .map((times) => times[leg])
      .filter((value) => value !== undefined)
      .slice(0, SAMPLE)
    const value = median(values)
    return {
      leg,
      runs: values.length,
      median: value,
      over: value !== null && value > TARGET_MINUTES
    }
  })
}

function format(value) {
  const whole = Math.round(value * 60)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** One pull request's legs, as its PROGRESS.md entry records them. */
export function renderOne(number, times) {
  return LEGS.map((leg) =>
    times[leg] === undefined
      ? `#${number} ${leg}: not green yet`
      : `#${number} ${leg}: ${format(times[leg])}`
  ).join('\n')
}

export function render(summary) {
  return summary
    .map(({ leg, runs, median: value, over }) =>
      value === null
        ? `${leg}: no successful runs`
        : `${leg}: median ${format(value)} over ${runs} pull requests${over ? ` (over the ${TARGET_MINUTES}-minute target)` : ''}`
    )
    .join('\n')
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  const repo = remote.replace(/\.git$/, '').replace(/.*[/:]([^/]+\/[^/]+)$/, '$1')
  const number = process.argv[2]
  if (number !== undefined) {
    if (!/^\d+$/.test(number)) {
      console.error('usage: ci-times.mjs [<pull request number>]')
      process.exit(2)
    }
    const sha = gh(`repos/${repo}/pulls/${number}`).head.sha
    console.log(
      renderOne(
        number,
        legTimes(gh(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs)
      )
    )
    process.exit(0)
  }
  const merged = gh(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`)
    .filter((pull) => pull.merged_at)
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
  const perCommit = []
  for (const pull of merged) {
    const times = legTimes(
      gh(`repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`).check_runs
    )
    perCommit.push(times)
    if (LEGS.every((leg) => perCommit.filter((t) => t[leg] !== undefined).length >= SAMPLE)) break
  }
  console.log(render(summarise(perCommit)))
}
