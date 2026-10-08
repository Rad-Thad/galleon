import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eligible, render } from './next.mjs'

/**
 * The agent's own tooling: what it picks next, what stops a session from
 * starting, and what stops a turn from ending.
 *
 * Each of these fails quietly when it is wrong. A wrong `next.mjs` sends a
 * session to a feature it cannot finish; an `init.sh` that dies on a stack
 * trace leaves the next session guessing; a Stop hook that never fires lets a
 * red branch be pushed. So each is run here the way it runs for real: the
 * scripts as processes, against PATHs and repositories built for the test.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const scratches: string[] = []
after(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-agent-test-'))
  scratches.push(dir)
  return dir
}

/** An executable script in `dir`, standing in for a real command. */
function stub(dir: string, name: string, body: string): void {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
}

/** A feature as features.json holds one, with only what `next.mjs` reads. */
function feature(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    milestone: id.split('-')[0],
    title: `Feature ${id}`,
    verification: 'ci',
    depends_on: [],
    passes: false,
    ...fields
  }
}

describe('what comes next', () => {
  test('is what has not passed and whose dependencies all have', () => {
    const list = eligible([
      feature('M0-01', { passes: true }),
      feature('M0-02', { depends_on: ['M0-01'] }),
      feature('M0-03', { depends_on: ['M0-02'] }),
      feature('M0-04')
    ])

    assert.deepEqual(
      list.map((entry) => entry.id),
      ['M0-02', 'M0-04']
    )
  })

  test('comes in milestone order, and in id order within one, by number', () => {
    const list = eligible([feature('M1-02'), feature('M0-10'), feature('M0-09'), feature('M10-01')])

    assert.deepEqual(
      list.map((entry) => entry.id),
      ['M0-09', 'M0-10', 'M1-02', 'M10-01']
    )
  })

  test('marks the interface work Gate 1 holds back, until Gate 1 passes', () => {
    const waiting = eligible([feature('M4-01'), feature('M1-20')])
    assert.equal(waiting.find((entry) => entry.id === 'M4-01')?.blockedBy, 'Gate 1')
    assert.match(render(waiting), /\[blocked: Gate 1\] M4-01/)

    const open = eligible([feature('M4-01'), feature('M1-20', { passes: true })])
    assert.equal(open[0].blockedBy, null)
  })

  test('says so when nothing is left', () => {
    assert.match(render(eligible([feature('M0-01', { passes: true })])), /Nothing is eligible/)
  })

  test('reads the real feature list without complaint', () => {
    const run = spawnSync(process.execPath, [join(here, 'next.mjs')], { encoding: 'utf8' })

    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^(\[blocked: [^\]]+\] )?M\d+-\d+ {2}/)
  })
})

/** Run one of init.sh's functions in a shell that has read the file. */
function initFunction(call: string, path: string): ReturnType<typeof spawnSync> {
  return spawnSync('/bin/bash', ['-c', `source "${join(here, 'init.sh')}"; ${call}`], {
    encoding: 'utf8',
    // The test decides which node and docker there are.
    env: {
      PATH: `${path}:/usr/bin:/bin`,
      HOME: process.env.HOME ?? '/tmp',
      // Somewhere with no Node 24 in it, wherever the machine keeps its own.
      GALLEON_NODE_DIR: scratch()
    },
    timeout: 60_000
  })
}

describe('a session that cannot start', () => {
  test('on the wrong Node says which Node it found, and what to do', () => {
    const bin = scratch()
    stub(bin, 'node', 'echo v22.11.0')

    const run = initFunction('check_node', bin)

    assert.equal(run.status, 1)
    assert.match(String(run.stderr), /Node 24 is needed and this is Node v22\.11\.0/)
    assert.doesNotMatch(String(run.stderr), /\n\s+at /, 'no stack trace')
  })

  test('without Docker says it is missing', () => {
    const bin = scratch()
    const run = spawnSync('/bin/bash', ['-c', `source "${join(here, 'init.sh')}"; check_docker`], {
      encoding: 'utf8',
      env: { PATH: bin },
      timeout: 60_000
    })

    assert.equal(run.status, 1)
    assert.match(run.stderr, /Docker is not installed/)
  })

  test('with Docker but no daemon says to start it', () => {
    const bin = scratch()
    stub(bin, 'docker', 'echo "Cannot connect to the Docker daemon" >&2; exit 1')

    const run = initFunction('check_docker', bin)

    assert.equal(run.status, 1)
    assert.match(String(run.stderr), /daemon is not answering/)
  })

  test('when RomM never answers says where it looked and for how long', async () => {
    // A port nothing listens on, found by opening one and closing it again.
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
      })
    })

    const run = initFunction(`wait_for_romm http://127.0.0.1:${port} 3`, '')

    assert.equal(run.status, 1)
    assert.match(
      String(run.stderr),
      new RegExp(`RomM never reported healthy at http://127.0.0.1:${port} within 3s`)
    )
  })

  test('with everything in place, the checks pass and say so', () => {
    const bin = scratch()
    stub(bin, 'node', 'echo v24.1.0')
    stub(bin, 'docker', 'exit 0')

    const run = initFunction('check_node && check_docker', bin)

    assert.equal(run.status, 0, String(run.stderr))
    assert.match(String(run.stdout), /node v24\.\d+\.\d+/)
    assert.match(String(run.stdout), /docker is answering/)
  })
})

/**
 * The caller's environment without git's own variables. Under a git hook they
 * name the caller's repository and index, and would win over `cwd`.
 */
function outsideGit(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  )
}

/**
 * A repository with an `origin/main`, the Stop hook in it, and a check that
 * fails on purpose, so whether the hook runs it is the only question.
 */
function repositoryWithHook(): string {
  const repo = scratch()
  const git = (...args: string[]): void => {
    const run = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: outsideGit() })
    assert.equal(run.status, 0, run.stderr)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  mkdirSync(join(repo, 'scripts', 'agent'), { recursive: true })
  mkdirSync(join(repo, 'docs'))
  mkdirSync(join(repo, 'src'))
  copyFileSync(join(here, 'stop-hook.sh'), join(repo, 'scripts', 'agent', 'stop-hook.sh'))
  stub(
    join(repo, 'scripts', 'agent'),
    'check.sh',
    'echo "format:check failed on src/broken.ts"; exit 1'
  )
  writeFileSync(join(repo, 'docs', 'notes.md'), 'notes\n')
  git('add', '.')
  git('commit', '-q', '-m', 'start')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  return repo
}

function stopHook(repo: string): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [join(repo, 'scripts', 'agent', 'stop-hook.sh')], {
    encoding: 'utf8',
    env: { ...outsideGit(), CLAUDE_PROJECT_DIR: repo },
    timeout: 60_000
  })
}

describe('the Stop hook', () => {
  test('lets a turn that changed no code end without running the checks', () => {
    const repo = repositoryWithHook()
    writeFileSync(join(repo, 'docs', 'notes.md'), 'more notes\n')

    const run = stopHook(repo)

    assert.equal(run.status, 0)
    assert.equal(run.stderr, '')
  })

  test('holds a turn that changed code while the checks fail, and says why', () => {
    const repo = repositoryWithHook()
    // Not yet known to git, which is still a change the checks are about.
    writeFileSync(join(repo, 'src', 'broken.ts'), 'export const x =\n')

    const run = stopHook(repo)

    assert.equal(run.status, 2, 'exit 2 is what refuses the stop')
    assert.match(String(run.stderr), /check\.sh fails on this branch/)
    assert.match(String(run.stderr), /format:check failed on src\/broken\.ts/)
  })

  test('lets the turn end once the checks pass', () => {
    const repo = repositoryWithHook()
    stub(join(repo, 'scripts', 'agent'), 'check.sh', 'echo green')
    writeFileSync(join(repo, 'src', 'fixed.ts'), 'export const x = 1\n')

    assert.equal(stopHook(repo).status, 0)
  })

  test("touches only its own repository when git's variables point elsewhere", () => {
    // A pre-commit hook under `git commit -a` exports the caller's temporary
    // index; a spawn that inherits it writes the throwaway's files there.
    const index = join(scratch(), 'index')
    const saved = process.env.GIT_INDEX_FILE
    process.env.GIT_INDEX_FILE = index
    try {
      const repo = repositoryWithHook()
      writeFileSync(join(repo, 'docs', 'notes.md'), 'more notes\n')

      assert.equal(stopHook(repo).status, 0)
      assert.equal(existsSync(index), false, "the caller's index was written to")
    } finally {
      if (saved === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = saved
    }
  })
})

describe('the session hooks', () => {
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as {
    hooks: Record<string, { hooks: { type: string; command: string }[] }[]>
  }
  const commands = (event: string): string[] =>
    (settings.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command))

  test('are registered: the Stop hook and the SessionStart hook', () => {
    assert.ok(commands('Stop').some((command) => command.endsWith('scripts/agent/stop-hook.sh')))
    assert.ok(
      commands('SessionStart').some((command) => command.endsWith('scripts/agent/session-start.sh'))
    )
  })

  test('the session start does nothing outside a cloud session', () => {
    const run = spawnSync('bash', [join(here, 'session-start.sh')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', CLAUDE_CODE_REMOTE: '' }
    })

    assert.equal(run.status, 0)
    assert.equal(run.stdout, '')
  })

  test('in a cloud session prints the ritual, and only the ritual', () => {
    const envFile = join(scratch(), 'env')
    writeFileSync(envFile, '')
    const run = spawnSync('bash', [join(here, 'session-start.sh')], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_ENV_FILE: envFile
      }
    })

    assert.equal(run.status, 0)
    assert.match(run.stdout, /^## Session ritual/)
    assert.match(run.stdout, /Device results first/)
    assert.doesNotMatch(run.stdout, /## Picking the next unit of work/)
  })
})
