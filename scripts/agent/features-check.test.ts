import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addedLines,
  catalogueIds,
  compare,
  flipErrors,
  forbiddenNames,
  REQUIRED_SOURCES,
  validate
} from './features-check.mjs'

/**
 * The guard on docs/features.json. Each rule has a fixture in
 * fixtures/features-check/ that breaks it and says what the guard must answer;
 * `valid.json` keeps every rule, flips included, and must draw no complaint.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const fixtures = join(here, 'fixtures', 'features-check')

interface Fixture {
  rule: string
  catalogue: string[]
  required?: string[]
  base?: Record<string, unknown>[]
  head: Record<string, unknown>[]
  progress?: string
  summaries?: Record<string, { status?: string; checks?: { id: string; result: string }[] }>
  acceptance?: Record<string, { items?: { feature: string; result: string }[] }>
  ancestors?: string[]
  expect: string[]
}

/** What the guard says about a fixture, the way the command would. */
function judge(fixture: Fixture): string[] {
  const errors = validate(fixture.head, {
    catalogue: fixture.catalogue,
    ...(fixture.required ? { required: fixture.required } : {})
  })
  if (errors.length > 0 || !fixture.base) return errors
  const { errors: changes, flipped } = compare(fixture.base, fixture.head)
  return [
    ...changes,
    ...flipErrors(flipped, {
      progress: fixture.progress ?? '',
      summary: (sha) => fixture.summaries?.[sha] ?? null,
      acceptance: (date) => fixture.acceptance?.[date] ?? null,
      readyIsAncestor: (id, sha) => (fixture.ancestors ?? []).includes(`${id}@${sha}`)
    })
  ]
}

describe('the feature list guard, rule by rule', () => {
  for (const name of readdirSync(fixtures).sort()) {
    const fixture = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Fixture
    test(`${name}: ${fixture.rule}`, () => {
      const errors = judge(fixture)
      assert.equal(errors.length, fixture.expect.length, errors.join('\n'))
      for (const expected of fixture.expect)
        assert.ok(
          errors.some((error) => error.includes(expected)),
          `expected "${expected}" among:\n${errors.join('\n')}`
        )
    })
  }
})

describe('the guard’s readings', () => {
  test('owes a feature to every REQ, PARITY and BEYOND item the research names', () => {
    assert.equal(REQUIRED_SOURCES.length, 15 + 48 + 18)
    assert.ok(REQUIRED_SOURCES.includes('PARITY-48') && REQUIRED_SOURCES.includes('BEYOND-18'))
  })

  test('reads the check catalogue out of TESTING.md, placeholders and all', () => {
    const ids = catalogueIds(readFileSync(join(root, 'docs', 'TESTING.md'), 'utf8'))
    for (const id of ['harness.run', 'safety.owner-state', 'launch.<emulator>', 'gate1.summary'])
      assert.ok(ids.includes(id), id)
    assert.ok(!ids.includes('Check id'), 'not the header row')
  })

  test('takes what an append-only file gained, repeated lines included', () => {
    assert.equal(addedLines('a\n- none\nb', 'a\n- none\nb\n- none\nc'), '- none\nc')
  })

  test('refuses the earlier plan’s trigger and sign-in names anywhere in .github/', () => {
    assert.deepEqual(
      forbiddenNames([
        { path: '.github/workflows/a.yml', text: 'url: ${{ secrets.ROUTINE_FIRE_URL }}' },
        { path: '.github/labels.yml', text: '- name: flaky' },
        { path: '.github/ISSUE_TEMPLATE/b.yml', text: 'TESTER_LOGIN and ROUTINE_FIRE_TOKEN' }
      ]),
      [
        '.github/workflows/a.yml: names ROUTINE_FIRE_URL; nothing in .github/ may',
        '.github/ISSUE_TEMPLATE/b.yml: names ROUTINE_FIRE_TOKEN; nothing in .github/ may',
        '.github/ISSUE_TEMPLATE/b.yml: names TESTER_LOGIN; nothing in .github/ may'
      ]
    )
  })

  test('passes the real feature list and the real .github/', () => {
    const run = spawnSync(process.execPath, [join(here, 'features-check.mjs')], {
      cwd: root,
      encoding: 'utf8'
    })
    assert.equal(run.status, 0, run.stderr)
  })
})

const scratches: string[] = []
after(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Git in a throwaway repository, deaf to the caller's own `GIT_*` settings. */
function repository(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-features-check-'))
  scratches.push(dir)
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  )
  const git = (...args: string[]): string => {
    const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env })
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim()
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'scripts', 'agent'), { recursive: true })
  mkdirSync(join(dir, 'docs'))
  copyFileSync(
    join(here, 'features-check.mjs'),
    join(dir, 'scripts', 'agent', 'features-check.mjs')
  )
  writeFileSync(
    join(dir, 'docs', 'TESTING.md'),
    '## Check catalogue\n\n| Check id | Passes when |\n| --- | --- |\n| `launch.<emulator>` | x |\n| `safety.owner-state` | x |\n| `safety.server-readonly` | x |\n'
  )
  return { dir, git }
}

function write(dir: string, features: unknown[], progress: string): void {
  writeFileSync(join(dir, 'docs', 'features.json'), JSON.stringify(features))
  writeFileSync(join(dir, 'docs', 'PROGRESS.md'), progress)
}

function feature(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    milestone: 'M1',
    title: id,
    description: id,
    source: REQUIRED_SOURCES,
    acceptance: ['Device check `launch.retroarch`: it starts.'],
    verification: 'device',
    depends_on: [],
    passes: false,
    ...fields
  }
}

describe('the command, against a repository', () => {
  test('reads the base, device-results and the history the way a pull request has them', () => {
    const { dir, git } = repository()
    write(dir, [feature('M1-01')], '# Progress\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    write(dir, [feature('M1-01')], '# Progress\n\n- READY-FOR-DEVICE M1-01\n')
    git('commit', '-qam', 'ready')
    const tested = git('rev-parse', 'HEAD')

    // The bridge's results for that build, on a branch of their own.
    git('checkout', '-q', '--orphan', 'results')
    git('rm', '-rqf', '.')
    mkdirSync(join(dir, 'results', tested), { recursive: true })
    const checks = ['launch.retroarch', 'safety.owner-state', 'safety.server-readonly']
    writeFileSync(
      join(dir, 'results', tested, 'summary.json'),
      JSON.stringify({ status: 'complete', checks: checks.map((id) => ({ id, result: 'pass' })) })
    )
    git('add', '.')
    git('commit', '-qm', 'results')
    git('update-ref', 'refs/remotes/origin/device-results', 'HEAD')
    git('checkout', '-q', 'main')
    git('branch', 'base', tested)

    const run = (): ReturnType<typeof spawnSync> =>
      spawnSync(process.execPath, ['scripts/agent/features-check.mjs', '--base', 'base'], {
        cwd: dir,
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
        )
      })

    write(
      dir,
      [feature('M1-01', { passes: true })],
      `# Progress\n\n- READY-FOR-DEVICE M1-01\n- PASSES M1-01 device:${tested}\n`
    )
    const flip = run()
    assert.equal(flip.status, 0, String(flip.stderr))

    write(
      dir,
      [feature('M1-01', { passes: true, title: 'Renamed' })],
      `# Progress\n\n- READY-FOR-DEVICE M1-01\n- PASSES M1-01 device:${'b'.repeat(40)}\n`
    )
    const refused = run()
    assert.equal(refused.status, 1)
    assert.match(String(refused.stderr), /M1-01: "title" changed/)
    assert.match(String(refused.stderr), /no results\/b{40}\/summary\.json/)

    const lost = spawnSync(
      process.execPath,
      ['scripts/agent/features-check.mjs', '--base', 'no-such-ref'],
      { cwd: dir, encoding: 'utf8' }
    )
    assert.equal(lost.status, 1, 'a base it cannot read is not a list with nothing in it')
    assert.match(String(lost.stderr), /cannot read docs\/features\.json at no-such-ref/)
  })
})
