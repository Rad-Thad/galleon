import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SESSION_LIMIT_MINUTES, planErrors, readyItems, render, type Plan } from './acceptance.mjs'

/**
 * The owner gives the project one session of at most two hours (ADR 0003).
 * A script that runs long, names a step nobody can follow, or leaves out a
 * ready feature wastes the only time there is, so the generator refuses the
 * first two and the repository's own script is held to its output.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const readJson = (path: string): unknown => JSON.parse(readFileSync(root + path, 'utf8'))

function feature(id: string, acceptance: string[], passes = false): Record<string, unknown> {
  return { id, title: `Title ${id}`, acceptance, passes }
}

const FEATURES = [
  feature('M3-01', ['Unit tests.', 'Acceptance session: open Quick Access and quit.']),
  feature('M3-02', ['Acceptance session: reboot twice.']),
  feature('M3-04', ['Acceptance session (informational): sleep mid-download.']),
  feature('M8-07', ['Acceptance session: the whole script.']),
  feature('M0-01', ['CI is green.'], true)
]

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    places: [
      { id: 'mac', title: 'At the Mac' },
      { id: 'nova', title: 'The Nova' },
      { id: 'android', title: 'Android' }
    ],
    before: [{ title: 'Back up', place: 'mac', minutes: 10, text: 'Copy the saves.' }],
    after: [{ title: 'Record', place: 'mac', minutes: 5, text: 'Write results.json.' }],
    wholeSession: 'M8-07',
    items: [
      {
        feature: 'M3-01',
        place: 'nova',
        minutes: 6,
        passWhen: 'Quit returns to Galleon.',
        steps: ['Press the ... button.', 'Choose Quit game.']
      },
      { feature: 'M3-02', place: 'nova', minutes: 8, passWhen: 'Galleon opens by itself.' },
      {
        feature: 'M3-04',
        place: 'android',
        minutes: 3,
        informational: true,
        steps: ['Press power during a download.']
      }
    ],
    ...overrides
  }
}

describe('the acceptance plan', () => {
  test('a plan that covers every session line and fits the session has no errors', () => {
    assert.deepEqual(planErrors(plan(), FEATURES), [])
  })

  test('a plan over the session limit is refused, counting items not ready yet', () => {
    const long = plan()
    long.items[1].minutes = SESSION_LIMIT_MINUTES
    assert.deepEqual(planErrors(long, FEATURES), [
      `the plan totals ${SESSION_LIMIT_MINUTES + 24} minutes, over the ${SESSION_LIMIT_MINUTES}-minute session`
    ])
  })

  test('a feature with a session line and no item is named', () => {
    const missing = plan({ items: plan().items.slice(0, 2) })
    assert.deepEqual(planErrors(missing, FEATURES), [
      'M3-04: has an acceptance-session line but no item in the plan'
    ])
  })

  test('items that name no feature, the wrong kind of line, a twin or a bad place are named', () => {
    const bad = plan()
    bad.items.push(
      { feature: 'M9-99', place: 'nova', minutes: 1, passWhen: 'x' },
      { feature: 'M3-01', place: 'nova', minutes: 1, passWhen: 'x' },
      { feature: 'M0-01', place: 'moon', minutes: 0, informational: true }
    )
    bad.items[1] = { ...bad.items[1], passWhen: undefined }
    assert.deepEqual(planErrors(bad, FEATURES), [
      'M0-01: unknown place "moon"',
      'M0-01: minutes must be a positive whole number',
      'M3-02: no passWhen',
      'M9-99: no such feature',
      'M3-01: planned twice',
      'M0-01: has no "Acceptance session (informational):" line'
    ])
  })
})

describe('what the script holds', () => {
  test('an acceptance item joins once PROGRESS.md marks it ready, and the whole session never does', () => {
    assert.deepEqual(readyItems(plan(), FEATURES, 'nothing yet'), [])
    const items = readyItems(
      plan(),
      FEATURES,
      '- READY-FOR-ACCEPTANCE M3-01\n- READY-FOR-ACCEPTANCE M8-07'
    )
    assert.deepEqual(
      items.map((item) => [item.feature, item.title, item.line]),
      [['M3-01', 'Title M3-01', 'open Quick Access and quit.']]
    )
  })

  test('an informational line joins once its code is merged, by either READY marker or a pass', () => {
    const viaDevice = readyItems(plan(), FEATURES, 'READY-FOR-DEVICE M3-04')
    assert.deepEqual(
      viaDevice.map((item) => [item.feature, item.line]),
      [['M3-04', 'sleep mid-download.']]
    )
    const passed = FEATURES.map((f) => (f.id === 'M3-04' ? { ...f, passes: true } : f))
    assert.equal(readyItems(plan(), passed, '').length, 1)
  })

  test('a ready item without steps stops the generator', () => {
    assert.throws(
      () => readyItems(plan(), FEATURES, 'READY-FOR-ACCEPTANCE M3-02'),
      /M3-02 is ready but docs\/acceptance-plan.json gives it no steps/
    )
  })
})

describe('the script', () => {
  const progress = 'READY-FOR-ACCEPTANCE M3-01\nREADY-FOR-DEVICE M3-04'
  const text = render(plan(), readyItems(plan(), FEATURES, progress), '1.0.0')

  test('each item names the build, its steps, what a pass looks like and the feature it decides', () => {
    assert.match(text, /^Build: \*\*Galleon 1\.0\.0\*\*/m)
    assert.match(
      text,
      /### M3-01: Title M3-01 \(about 6 min\)\n\nOn Galleon 1\.0\.0; decides M3-01\.\n\n1\. Press the \.\.\. button\.\n2\. Choose Quit game\.\n\nIt passes when: Quit returns to Galleon\./
    )
    assert.match(
      text,
      /On Galleon 1\.0\.0; informational, decides nothing\.\n\n1\. Press power during a download\.\n\nWhat to notice: sleep mid-download\./
    )
  })

  test('items are grouped by place with a time per group, the backup first and the results last', () => {
    const order = [
      '### Back up',
      '## The Nova (about 6 min)',
      '## Android (about 3 min)',
      '### Record',
      '## Results'
    ].map((heading) => text.indexOf(heading))
    assert.ok(order.every((at) => at >= 0))
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b)
    )
    assert.match(text, /About 24 minutes in all/)
    assert.doesNotMatch(text, /## At the Mac/)
  })

  test('the results table has a row per item for the local session to fill in', () => {
    assert.match(
      text,
      /\| Feature \| Item \| Result \| Notes \|\n.*\n\| M3-01 \| Title M3-01 \|  \|  \|\n\| M3-04 \| Title M3-04 \(informational\) \|  \|  \|\n$/
    )
  })

  test('the same inputs write the same script', () => {
    assert.equal(render(plan(), readyItems(plan(), FEATURES, progress), '1.0.0'), text)
  })

  test('with nothing ready it says so', () => {
    assert.match(render(plan(), [], '1.0.0'), /No feature is ready for the session yet/)
  })
})

describe("the repository's own script", () => {
  test('docs/acceptance-plan.json covers the feature list and fits two hours', () => {
    assert.deepEqual(
      planErrors(
        readJson('docs/acceptance-plan.json') as Plan,
        readJson('docs/features.json') as Record<string, unknown>[]
      ),
      []
    )
  })

  test('docs/ACCEPTANCE.md is what the generator writes now', () => {
    const run = spawnSync(process.execPath, [root + 'scripts/agent/acceptance.mjs', '--check'], {
      encoding: 'utf8'
    })
    assert.equal(run.status, 0, run.stderr)
  })
})
