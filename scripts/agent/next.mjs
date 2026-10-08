#!/usr/bin/env node
//
// The features a session may pick up next, in the order it should.
//
// A feature is eligible when it has not passed and everything it depends on
// has. Milestones come in order, and within one the ids do; the first line is
// the default choice in CLAUDE.md's "Picking the next unit of work". Features
// a gate holds back are listed too, marked, so a session can see why the one
// it expected is not first: M4's interface work waits for Gate 1 (docs/PLAN.md
// section 9), which is M1-20 passing on device results.
//
// Reads docs/features.json and nothing else; changes nothing.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The feature whose passing opens Gate 1, and the milestone that waits on it. */
const GATE_1 = 'M1-20'
const GATED_BY_GATE_1 = 'M4'

/** `M1-02` → [1, 2], so ids sort as numbers rather than as text. */
function order(id) {
  const match = /^M(\d+)-(\d+)$/.exec(id)
  return match ? [Number(match[1]), Number(match[2])] : [Infinity, Infinity]
}

function byId(a, b) {
  const [ma, na] = order(a.id)
  const [mb, nb] = order(b.id)
  return ma - mb || na - nb
}

/**
 * Every feature that has not passed and whose dependencies all have, in the
 * order to take them, each with the gate holding it back, if one is.
 */
export function eligible(features) {
  const passed = new Set(features.filter((feature) => feature.passes).map((feature) => feature.id))
  return features
    .filter((feature) => !feature.passes)
    .filter((feature) => (feature.depends_on ?? []).every((id) => passed.has(id)))
    .sort(byId)
    .map((feature) => ({
      id: feature.id,
      title: feature.title,
      verification: feature.verification,
      blockedBy: feature.milestone === GATED_BY_GATE_1 && !passed.has(GATE_1) ? 'Gate 1' : null
    }))
}

/** One line per feature, the gated ones after a marker. */
export function render(list) {
  if (list.length === 0)
    return 'Nothing is eligible: every feature has passed or waits on one that has not.'
  return list
    .map(
      (feature) =>
        `${feature.blockedBy ? `[blocked: ${feature.blockedBy}] ` : ''}${feature.id}  ${feature.title}  (${feature.verification})`
    )
    .join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const features = JSON.parse(
    readFileSync(new URL('../../docs/features.json', import.meta.url), 'utf8')
  )
  console.log(render(eligible(features)))
}
