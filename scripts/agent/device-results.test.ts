import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyse,
  ingestedShas,
  issuesToOpen,
  progressLines,
  readBranch,
  regressionTitle,
  render,
  setPasses,
  type IndexEntry,
  type Summary
} from './device-results.mjs'

/**
 * The only way a device feature's `passes` flips (CLAUDE.md, "Device
 * results"), so each rule of docs/TESTING.md's "How a device feature passes"
 * is held here: against plain data first, then against real branches in a
 * scratch repository, the way a session runs it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'device-results.mjs')

const SHA = (n: number) => n.toString(16).padStart(40, 'a')
const SAFE = [
  { id: 'safety.owner-state', result: 'pass' },
  { id: 'safety.server-readonly', result: 'pass' }
]

const features = [
  {
    id: 'M9-01',
    verification: 'device',
    acceptance: [
      'Device check `x.one`: does one thing.',
      'Device check `x.two` and device check `x.three`: more.'
    ],
    passes: false
  },
  {
    id: 'M9-02',
    verification: 'device',
    acceptance: ['Device check `y.one`: it works.'],
    passes: true
  },
  {
    id: 'M9-03',
    verification: 'ci',
    acceptance: ['Device check `x.one` is mentioned, gating nothing.'],
    passes: false
  }
]

function summary(
  status: string,
  checks: { id: string; result: string; reason?: string }[]
): Summary {
  return { status, checks }
}

/** Runs given oldest first, as `{sha number: summary}`; the index lists them newest first. */
function input(runs: [number, Summary | null][], extra: Record<string, unknown> = {}) {
  const index: IndexEntry[] = runs
    .map(([n, s], i) => ({
      sha: SHA(n),
      status: s?.status ?? 'error',
      finishedAt: `2026-10-0${i + 1}T10:00:00Z`
    }))
    .toReversed()
  return {
    features,
    index,
    summaries: new Map(runs.map(([n, s]) => [SHA(n), s])),
    progress: '',
    now: '2026-10-09T12:00:00Z',
    readyIsAncestor: () => true,
    ...extra
  }
}

const allPass = [
  ...SAFE,
  { id: 'x.one', result: 'pass' },
  { id: 'x.two', result: 'pass' },
  { id: 'x.three', result: 'pass' },
  { id: 'y.one', result: 'pass' }
]

describe('device-results: the rules', () => {
  test('a feature flips when every check it names and both safety checks pass', () => {
    const a = analyse(input([[1, summary('complete', allPass)]]))
    assert.deepEqual(a.flips, [{ id: 'M9-01', sha: SHA(1) }])
    assert.deepEqual(a.changes, [{ id: 'M9-01', passes: true }])
    assert.deepEqual(progressLines(a), [
      `DEVICE-RESULTS ${SHA(1)} complete`,
      `PASSES M9-01 device:${SHA(1)}`
    ])
  })

  test('a flip needs the READY-FOR-DEVICE commit to be an ancestor of the tested sha', () => {
    const asked: string[] = []
    const a = analyse(
      input([[1, summary('complete', allPass)]], {
        readyIsAncestor: (id: string, sha: string) => {
          asked.push(`${id}@${sha}`)
          return false
        }
      })
    )
    assert.deepEqual(a.flips, [])
    assert.deepEqual(a.changes, [])
    assert.deepEqual(asked, [`M9-01@${SHA(1)}`])
  })

  test('one check missing, skipped or failing, or a safety check absent, flips nothing', () => {
    const without = (id: string) => allPass.filter((c) => c.id !== id)
    for (const checks of [
      without('x.three'),
      [...without('x.two'), { id: 'x.two', result: 'skip', reason: 'missing-bios' }],
      without('safety.server-readonly')
    ])
      assert.deepEqual(analyse(input([[1, summary('partial', checks)]])).flips, [])
  })

  test('a safety failure blocks every flip from that run and is reported first', () => {
    const checks = [
      ...allPass.filter((c) => c.id !== 'safety.owner-state'),
      { id: 'safety.owner-state', result: 'pass' },
      { id: 'safety.audio-muted', result: 'fail', reason: 'volume changed' }
    ]
    const a = analyse(input([[1, summary('complete', checks)]]))
    assert.deepEqual(a.flips, [])
    assert.deepEqual(a.safety, [
      { sha: SHA(1), id: 'safety.audio-muted', result: 'fail', reason: 'volume changed' }
    ])
    const text = render(a)
    assert.match(text, /SAFETY FAILURES/)
    assert.ok(text.indexOf('safety.audio-muted') < text.indexOf('Newly failing'))
    assert.deepEqual(
      issuesToOpen(a, []).map((i) => [i.title, i.labels]),
      [[regressionTitle('safety.audio-muted'), ['regression', 'save-sync']]]
    )
  })

  test('a withheld, error, skipped or aborted summary flips nothing and reverts nothing', () => {
    for (const status of ['withheld', 'error', 'skipped', 'aborted-by-user']) {
      const failing = [...allPass.filter((c) => c.id !== 'y.one'), { id: 'y.one', result: 'fail' }]
      const a = analyse(input([[1, summary(status, failing)]]))
      assert.deepEqual([a.flips, a.reverts, a.changes, a.regressions], [[], [], [], []], status)
      assert.deepEqual(progressLines(a), [`DEVICE-RESULTS ${SHA(1)} ${status}`])
    }
    assert.deepEqual(analyse(input([[1, null]])).flips, [])
  })

  test('a later failure reverts the flip and opens exactly one regression issue', () => {
    const failing = (reason: string) => [
      ...allPass.filter((c) => c.id !== 'x.two'),
      { id: 'x.two', result: 'fail', reason }
    ]
    const a = analyse(
      input([
        [1, summary('complete', allPass)],
        [2, summary('complete', failing('first'))],
        [3, summary('partial', failing('second'))]
      ])
    )
    assert.deepEqual(a.flips, [{ id: 'M9-01', sha: SHA(1) }])
    assert.deepEqual(
      a.reverts.map((r) => [r.id, r.sha]),
      [['M9-01', SHA(2)]]
    )
    assert.deepEqual(a.changes, [], 'it ends where it started')
    assert.deepEqual(
      progressLines(a).filter((l) => l.startsWith('PASSES')),
      []
    )
    assert.deepEqual(
      a.regressions.map((r) => [r.id, r.sha, r.features]),
      [['x.two', SHA(2), ['M9-01']]]
    )
    const issues = issuesToOpen(a, [])
    assert.equal(issues.length, 1)
    assert.equal(issues[0].title, regressionTitle('M9-01'))
    assert.match(issues[0].body, /`x\.two`: fail \(first\)/)
    assert.deepEqual(issuesToOpen(a, [regressionTitle('M9-01')]), [], 'not again while one is open')
  })

  test('a passed feature failing on a newer build goes back to false', () => {
    const failing = [...allPass.filter((c) => c.id !== 'y.one'), { id: 'y.one', result: 'error' }]
    const a = analyse(input([[1, summary('complete', failing)]]))
    assert.deepEqual(a.changes, [
      { id: 'M9-01', passes: true },
      { id: 'M9-02', passes: false }
    ])
    assert.deepEqual(
      issuesToOpen(a, []).map((i) => i.title),
      [regressionTitle('M9-02')]
    )
  })

  test('only results PROGRESS.md has not recorded are new; they are compared with the run before', () => {
    const progress = `- DEVICE-RESULTS ${SHA(1)} complete\n`
    assert.deepEqual([...ingestedShas(progress)], [SHA(1)])
    const before = [...SAFE, { id: 'x.one', result: 'pass' }, { id: 'x.two', result: 'fail' }]
    const now = [...SAFE, { id: 'x.one', result: 'fail' }, { id: 'x.two', result: 'pass' }]
    const a = analyse(
      input(
        [
          [1, summary('complete', before)],
          [2, summary('withheld', [])],
          [3, summary('complete', now)]
        ],
        { progress }
      )
    )
    assert.deepEqual(
      a.fresh.map((r) => r.sha),
      [SHA(2), SHA(3)]
    )
    assert.deepEqual(
      a.regressions.map((r) => [r.id, r.features]),
      [['x.one', ['M9-01', 'M9-03']]]
    )
    assert.deepEqual(
      a.newPasses.map((p) => p.id),
      ['x.two']
    )
  })

  test('problem reports and acceptance results newer than the last ingested result', () => {
    const a = analyse(
      input([[1, summary('complete', SAFE)]], {
        progress: `DEVICE-RESULTS ${SHA(1)} complete`,
        reports: ['20261001T095959Z', '20261001T100001Z'],
        acceptance: ['2026-09-30', '2026-10-01']
      })
    )
    assert.deepEqual(a.reports, ['20261001T100001Z'])
    assert.deepEqual(a.acceptance, ['2026-10-01'])
    assert.deepEqual(analyse(input([], { reports: ['20200101T000000Z'] })).reports, [
      '20200101T000000Z'
    ])
  })

  test('the summary reads in the order a session acts, ending on the bridge', () => {
    const a = analyse(
      input([[1, summary('complete', allPass)]], {
        status: { bridgeVersion: 1, lastSeen: '2026-10-09T09:30:00Z', lastSkip: 'on battery' },
        reports: ['20261009T000000Z']
      })
    )
    const text = render(a)
    const order = [
      'New results',
      'Safety failures',
      'Newly failing',
      'Newly passing',
      'New problem reports',
      'Bridge'
    ]
    const at = order.map((heading) => text.indexOf(heading))
    assert.ok(
      at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])),
      text
    )
    assert.match(text, /M9-01 passes: PASSES M9-01 device:/)
    assert.match(text, /Bridge: last seen 2\.5 h ago .*version 1, last skip: on battery/)
    assert.match(render(analyse(input([]))), /Bridge: never seen/)
  })

  test('setPasses changes that one flag and no other byte', () => {
    // Laid out as prettier lays out docs/features.json: short arrays on one line.
    const text = [
      '[',
      '  {',
      '    "id": "M9-01",',
      '    "acceptance": ["Device check `x.one`: \\"passes\\": false is only text here."],',
      '    "passes": false',
      '  },',
      '  { "id": "M9-02", "depends_on": ["M9-01"], "passes": false }',
      ']',
      ''
    ].join('\n')
    const changed = setPasses(text, 'M9-02', true)
    assert.equal(changed.length, text.length - 1)
    assert.deepEqual(
      (JSON.parse(changed) as { id: string; passes: boolean }[]).map((f) => [f.id, f.passes]),
      [
        ['M9-01', false],
        ['M9-02', true]
      ]
    )
    assert.equal(setPasses(changed, 'M9-02', false), text)
    assert.deepEqual(
      (JSON.parse(setPasses(text, 'M9-01', true)) as { passes: boolean }[]).map((f) => f.passes),
      [true, false]
    )
    assert.throws(() => setPasses(text, 'M99-99', true), /not in features\.json/)
  })

  test('the script has no way to write the device-results branch', () => {
    const source = readFileSync(script, 'utf8')
    assert.doesNotMatch(source, /['"`]push['"`]/)
    assert.doesNotMatch(source, /git\s+push/)
    assert.doesNotMatch(source, /['"`](commit|update-ref|hash-object|write-tree)['"`]/)
  })
})

// ---------------------------------------------------------------------------
// Against real branches, through the command.

const scratch: string[] = []
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t.invalid'
    }
  }).trim()
}

function write(dir: string, path: string, text: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

/**
 * A repository whose main line has commits `before` (no marker), `ready`
 * (adds `READY-FOR-DEVICE M9-01`) and `later`, and a device-results branch
 * holding one result per name in `tested`, oldest first.
 */
function repository(tested: ('before' | 'ready' | 'later')[], padding = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'device-results-'))
  scratch.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  write(dir, 'docs/features.json', `${JSON.stringify(features, null, 2)}\n`)
  write(dir, 'docs/PROGRESS.md', '# Progress\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'before')
  const shas: Record<string, string> = { before: git(dir, 'rev-parse', 'HEAD') }
  write(dir, 'docs/PROGRESS.md', '# Progress\n\n- READY-FOR-DEVICE M9-01\n')
  git(dir, 'commit', '-q', '-am', 'ready')
  shas.ready = git(dir, 'rev-parse', 'HEAD')
  write(dir, 'src.txt', 'later\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'later')
  shas.later = git(dir, 'rev-parse', 'HEAD')

  git(dir, 'checkout', '-q', '--orphan', 'device-results')
  git(dir, 'rm', '-rq', '--cached', '.')
  rmSync(join(dir, 'docs'), { recursive: true })
  rmSync(join(dir, 'src.txt'))
  const index: IndexEntry[] = []
  const runs = [
    ...Array.from({ length: padding }, (_, i) => SHA(1000 + i)),
    ...tested.map((name) => shas[name])
  ]
  runs.forEach((sha, i) => {
    write(dir, `results/${sha}/summary.json`, JSON.stringify(summary('complete', allPass)))
    index.unshift({
      sha,
      status: 'complete',
      finishedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()
    })
  })
  write(dir, 'results/index.json', JSON.stringify(index))
  write(
    dir,
    'bridge/status.json',
    JSON.stringify({ bridgeVersion: 1, lastSeen: '2026-10-09T09:00:00Z' })
  )
  write(dir, 'reports/20261009T080000Z/report.json', '{}')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'results')
  git(dir, 'checkout', '-q', 'main')
  return { dir, shas }
}

function run(dir: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [script, ...args, '--root', dir, '--ref', 'device-results', '--no-fetch', '--no-issues'],
    { encoding: 'utf8' }
  )
}

describe('device-results: fixture branches', () => {
  test('a result for a commit before READY-FOR-DEVICE flips nothing; one after it flips', () => {
    const { dir, shas } = repository(['before', 'later'])
    const summarised = run(dir, '--summary')
    assert.equal(summarised.status, 0, summarised.stderr)
    assert.match(summarised.stdout, new RegExp(`M9-01 passes: PASSES M9-01 device:${shas.later}`))
    assert.doesNotMatch(summarised.stdout, new RegExp(`device:${shas.before}`))
    assert.match(summarised.stdout, /reports\/20261009T080000Z\//)
    assert.equal(
      readFileSync(join(dir, 'docs/features.json'), 'utf8'),
      `${JSON.stringify(features, null, 2)}\n`,
      '--summary writes nothing'
    )

    const branchBefore = git(dir, 'rev-parse', 'device-results')
    const applied = run(dir, '--apply')
    assert.equal(applied.status, 0, applied.stderr)
    const written = JSON.parse(readFileSync(join(dir, 'docs/features.json'), 'utf8'))
    assert.equal(written.find((f: { id: string }) => f.id === 'M9-01').passes, true)
    assert.match(applied.stdout, new RegExp(`- DEVICE-RESULTS ${shas.before} complete`))
    assert.match(applied.stdout, new RegExp(`- PASSES M9-01 device:${shas.later}`))
    assert.equal(git(dir, 'rev-parse', 'device-results'), branchBefore, 'the branch is only read')
  })

  test('only a result for a commit before READY-FOR-DEVICE: no flip', () => {
    const { dir } = repository(['before'])
    run(dir, '--apply')
    const written = JSON.parse(readFileSync(join(dir, 'docs/features.json'), 'utf8'))
    assert.equal(written.find((f: { id: string }) => f.id === 'M9-01').passes, false)
  })

  test('readBranch finds the index, every summary, the bridge and the reports', () => {
    const { dir, shas } = repository(['ready'])
    const branch = readBranch(dir, 'device-results')
    assert.deepEqual(
      branch.index.map((e) => e.sha),
      [shas.ready]
    )
    assert.equal(branch.summaries.get(shas.ready)?.status, 'complete')
    assert.equal(branch.status?.bridgeVersion, 1)
    assert.deepEqual(branch.reports, ['20261009T080000Z'])
    assert.deepEqual(branch.acceptance, [])
  })

  test('with no device-results branch it says so and succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'device-results-'))
    scratch.push(dir)
    git(dir, 'init', '-q')
    const result = run(dir, '--summary')
    assert.equal(result.status, 0)
    assert.match(result.stdout, /No device results yet/)
  })

  test('a 60-result branch is read and summarised in under 10 seconds', () => {
    const { dir } = repository(['later'], 59)
    const started = performance.now()
    const result = run(dir, '--summary')
    const seconds = (performance.now() - started) / 1000
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /New results since the last ingestion: 60/)
    assert.ok(seconds < 10, `${seconds.toFixed(1)} s`)
  })
})
