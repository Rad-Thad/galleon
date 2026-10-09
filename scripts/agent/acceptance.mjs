#!/usr/bin/env node
//
// Writes docs/ACCEPTANCE.md, the one script the owner's acceptance session
// follows (ADR 0003, docs/TESTING.md "The acceptance session").
//
// An `acceptance` feature joins the script once a session has recorded
// `READY-FOR-ACCEPTANCE <id>` in docs/PROGRESS.md; an informational
// `Acceptance session (informational):` line joins once its feature's code is
// merged (passed, or READY for the device or the session), since a step for
// code that does not exist yet would waste the owner's time. Where an item
// sits, how long it takes, its exact menus and buttons and what a pass looks
// like come from docs/acceptance-plan.json, because a feature's acceptance
// line says what is judged but not how to get there on the finished build.
//
// The session is at most two hours, so the plan's estimates are summed over
// every item it will ever hold, not only the ready ones: an estimate that does
// not fit fails now rather than when the owner is invited.
//
// `--check` exits non-zero when docs/ACCEPTANCE.md is not what this would
// write; `--build <version>` names the build the session installs (the
// package version otherwise).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const SESSION_LIMIT_MINUTES = 120

const SESSION_LINE = /^Acceptance session: /
const INFORMATIONAL_LINE = /^Acceptance session \(informational\): /

/** The ids a PROGRESS.md marker names, e.g. every `READY-FOR-ACCEPTANCE M3-01`. */
function marked(progress, marker) {
  return new Set(
    [...progress.matchAll(new RegExp(`\\b${marker} (M\\d+-\\d+)\\b`, 'g'))].map((m) => m[1])
  )
}

function minutesOf(plan) {
  return [...plan.before, ...plan.items, ...plan.after].reduce((sum, step) => sum + step.minutes, 0)
}

/**
 * What is wrong with the plan against the feature list: every feature with an
 * acceptance-session line has exactly one item, every item names such a
 * feature and a known place, and the whole plan fits the session.
 */
export function planErrors(plan, features) {
  const errors = []
  const places = new Set(plan.places.map((place) => place.id))
  const byId = new Map(features.map((feature) => [feature.id, feature]))
  const seen = new Set()
  for (const step of [...plan.before, ...plan.after, ...plan.items]) {
    const name = step.feature ?? step.title
    if (!places.has(step.place)) errors.push(`${name}: unknown place "${step.place}"`)
    if (!Number.isInteger(step.minutes) || step.minutes <= 0)
      errors.push(`${name}: minutes must be a positive whole number`)
  }
  for (const item of plan.items) {
    const feature = byId.get(item.feature)
    if (seen.has(item.feature)) errors.push(`${item.feature}: planned twice`)
    seen.add(item.feature)
    if (!feature) {
      errors.push(`${item.feature}: no such feature`)
      continue
    }
    const pattern = item.informational ? INFORMATIONAL_LINE : SESSION_LINE
    if (!feature.acceptance.some((line) => pattern.test(line)))
      errors.push(
        `${item.feature}: has no "${item.informational ? 'Acceptance session (informational)' : 'Acceptance session'}:" line`
      )
    if (!item.informational && !item.passWhen) errors.push(`${item.feature}: no passWhen`)
  }
  for (const feature of features) {
    if (feature.id === plan.wholeSession || seen.has(feature.id)) continue
    if (feature.acceptance.some((line) => SESSION_LINE.test(line) || INFORMATIONAL_LINE.test(line)))
      errors.push(`${feature.id}: has an acceptance-session line but no item in the plan`)
  }
  const total = minutesOf(plan)
  if (total > SESSION_LIMIT_MINUTES)
    errors.push(
      `the plan totals ${total} minutes, over the ${SESSION_LIMIT_MINUTES}-minute session`
    )
  return errors
}

/**
 * The items the script holds now, in plan order, each with the acceptance
 * line it decides. Throws when one has no steps yet: an item the owner cannot
 * follow button by button is not ready, whatever PROGRESS.md says.
 */
export function readyItems(plan, features, progress) {
  const forSession = marked(progress, 'READY-FOR-ACCEPTANCE')
  const merged = new Set([
    ...forSession,
    ...marked(progress, 'READY-FOR-DEVICE'),
    ...features.filter((feature) => feature.passes).map((feature) => feature.id)
  ])
  const byId = new Map(features.map((feature) => [feature.id, feature]))
  const items = []
  for (const item of plan.items) {
    const ready = item.informational ? merged.has(item.feature) : forSession.has(item.feature)
    if (!ready) continue
    if (!item.steps?.length)
      throw new Error(`${item.feature} is ready but docs/acceptance-plan.json gives it no steps`)
    const feature = byId.get(item.feature)
    const pattern = item.informational ? INFORMATIONAL_LINE : SESSION_LINE
    const line = feature.acceptance.find((text) => pattern.test(text)).replace(pattern, '')
    items.push({ ...item, title: feature.title, line })
  }
  return items
}

function section(lines, heading, minutes, body) {
  lines.push(`### ${heading} (about ${minutes} min)`, '', ...body, '')
}

/** docs/ACCEPTANCE.md for these items. */
export function render(plan, items, build) {
  const minutes =
    [...plan.before, ...plan.after].reduce((sum, s) => sum + s.minutes, 0) +
    items.reduce((sum, item) => sum + item.minutes, 0)
  const lines = [
    '# Galleon acceptance session',
    '',
    '<!-- Written by scripts/agent/acceptance.mjs from docs/features.json, docs/acceptance-plan.json and docs/PROGRESS.md. Edit those, then run it again. -->',
    '',
    `Build: **Galleon ${build}**. Settings → About shows this version; if it shows another, stop and tell the local Claude session.`,
    '',
    `About ${minutes} minutes in all, never more than ${SESSION_LIMIT_MINUTES} minutes. The local Claude session on the Mac reads each step to you, does every terminal and GitHub step, and fills in the results table at the end. You hold the Nova (and your phone where a step says so) and say what you see.`,
    ''
  ]
  for (const s of plan.before) section(lines, s.title, s.minutes, [s.text])
  if (items.length === 0) {
    lines.push(
      'No feature is ready for the session yet. Items appear here as their code is merged.',
      ''
    )
  }
  for (const place of plan.places) {
    const here = items.filter((item) => item.place === place.id)
    if (here.length === 0) continue
    const total = here.reduce((sum, item) => sum + item.minutes, 0)
    lines.push(`## ${place.title} (about ${total} min)`, '')
    for (const item of here) {
      const kind = item.informational ? 'informational, decides nothing' : `decides ${item.feature}`
      section(lines, `${item.feature}: ${item.title}`, item.minutes, [
        `On Galleon ${build}; ${kind}.`,
        '',
        ...item.steps.map((text, i) => `${i + 1}. ${text}`),
        '',
        item.informational ? `What to notice: ${item.line}` : `It passes when: ${item.passWhen}`
      ])
    }
  }
  for (const s of plan.after) section(lines, s.title, s.minutes, [s.text])
  lines.push(
    '## Results',
    '',
    'Result is pass, fail or skip. Notes are in your words, with no addresses or account names.',
    '',
    '| Feature | Item | Result | Notes |',
    '| ------- | ---- | ------ | ----- |',
    ...items.map(
      (item) =>
        `| ${item.feature} | ${item.title}${item.informational ? ' (informational)' : ''} |  |  |`
    ),
    ''
  )
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const features = JSON.parse(read('docs/features.json'))
  const plan = JSON.parse(read('docs/acceptance-plan.json'))
  const args = process.argv.slice(2)
  const buildAt = args.indexOf('--build')
  const build = buildAt >= 0 ? args[buildAt + 1] : JSON.parse(read('package.json')).version
  const errors = planErrors(plan, features)
  if (errors.length > 0) {
    console.error(`docs/acceptance-plan.json:\n  ${errors.join('\n  ')}`)
    process.exit(1)
  }
  const text = render(plan, readyItems(plan, features, read('docs/PROGRESS.md')), build)
  const target = new URL('../../docs/ACCEPTANCE.md', import.meta.url)
  if (args.includes('--check')) {
    let current = null
    try {
      current = readFileSync(target, 'utf8')
    } catch {
      // A missing file is as stale as a wrong one.
    }
    if (current !== text) {
      console.error('docs/ACCEPTANCE.md is stale: run node scripts/agent/acceptance.mjs')
      process.exit(1)
    }
  } else {
    writeFileSync(target, text)
  }
}
