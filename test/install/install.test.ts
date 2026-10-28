import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

/**
 * install.sh, run the way its first line tells a person to run it — fetched
 * with curl and piped into bash — against a stand-in for the release download
 * URLs, with a throw-away HOME and a PATH holding bash, curl and coreutils and
 * nothing else. Not part of `npm test`: it needs `desktop-file-validate`,
 * which CI installs for this step (release.yml, "Install script").
 */

const ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = readFileSync(join(ROOT, 'install.sh'))
const STEAM_SCRIPT = readFileSync(join(ROOT, 'packaging', 'rommix-steam.sh'))
const APP_ID = 'io.github.Rad-Thad.Galleon'

/** Everything the script may call. A tool missing from here fails the run. */
const TOOLS = ['bash', 'curl', 'sha256sum', 'mkdir', 'mktemp', 'chmod', 'mv', 'rm', 'uname', 'cat']

const scratches: string[] = []
after(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-install-'))
  scratches.push(dir)
  return dir
}

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex')
}

/** One release's files, with SHA256SUMS written over them unless given. */
function release(tag: string, files: Record<string, string | Buffer>, sums?: string) {
  const all: Record<string, string | Buffer> = { ...files }
  all.SHA256SUMS =
    sums ??
    Object.entries(files)
      .map(([name, body]) => `${sha256(body)}  ${name}\n`)
      .join('')
  return { tag, files: all }
}

function images(tag: string): Record<string, string | Buffer> {
  return {
    'Galleon-arm64.AppImage': `#!/bin/sh\necho arm64 ${tag}\n`,
    'Galleon-x86_64.AppImage': `#!/bin/sh\necho x86_64 ${tag}\n`,
    'galleon-steam.sh': STEAM_SCRIPT
  }
}

/**
 * GitHub's two download URLs: `latest/download/<name>`, which redirects to the
 * newest stable release, and `download/<tag>/<name>`. `stable` null is a
 * repository with no stable release yet.
 */
let stable: ReturnType<typeof release> | null
let nightly: ReturnType<typeof release>
let server: Server
let origin = ''
const requests: string[] = []

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    requests.push(url)
    if (url === '/raw/install.sh') return void res.end(SCRIPT)
    const latest = /^\/releases\/latest\/download\/([^/]+)$/.exec(url)
    if (latest && stable) {
      res.writeHead(302, { location: `/releases/download/${stable.tag}/${latest[1]}` })
      return void res.end()
    }
    const tagged = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url)
    const from = [stable, nightly].find((r) => r?.tag === tagged?.[1])
    const body = tagged && from?.files[tagged[2]]
    if (body === undefined || body === null) {
      res.writeHead(404)
      return void res.end('Not Found')
    }
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

interface Machine {
  home: string
  tmp: string
  bin: string
}

/** A HOME, a TMPDIR to prove untouched, and a PATH of only `TOOLS`. */
function machine(arch = 'x86_64', extra: string[] = []): Machine {
  const dir = scratch()
  const m = { home: join(dir, 'home dir'), tmp: join(dir, 'tmp'), bin: join(dir, 'bin') }
  for (const d of Object.values(m)) mkdirSync(d)
  for (const tool of [...TOOLS, ...extra]) {
    const real = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim()
    if (tool === 'uname') {
      writeFileSync(join(m.bin, tool), `#!${join(m.bin, 'bash')}\necho ${arch}\n`, { mode: 0o755 })
    } else {
      symlinkSync(real, join(m.bin, tool))
    }
  }
  // Whatever sudo would be: its being called is the failure.
  writeFileSync(join(m.bin, 'sudo'), `#!${join(m.bin, 'bash')}\ntouch "${dir}/sudo-called"\n`, {
    mode: 0o755
  })
  return m
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function install(m: Machine, args: string[]): Promise<Run> {
  const child = spawn(
    join(m.bin, 'bash'),
    ['-c', 'curl -fsSL "$1/raw/install.sh" | bash -s -- "${@:2}"', '_', origin, ...args],
    {
      env: {
        PATH: m.bin,
        HOME: m.home,
        TMPDIR: m.tmp,
        GALLEON_RELEASES_URL: `${origin}/releases`
      }
    }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  return new Promise((resolve) =>
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  )
}

/** Every path under HOME with its mode, which is the whole of what a run left. */
function tree(home: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const st = statSync(path)
      out[relative(home, path)] = (st.mode & 0o777).toString(8)
      if (st.isDirectory()) walk(path)
    }
  }
  walk(home)
  return out
}

const APPS = 'Applications'
const MENU = '.local/share/applications'

function installed(image: string): Record<string, string> {
  return {
    '.local': '755',
    '.local/share': '755',
    [MENU]: '755',
    [`${MENU}/${APP_ID}.desktop`]: '644',
    [`${MENU}/${APP_ID}.svg`]: '644',
    [APPS]: '755',
    [`${APPS}/${image}`]: '755',
    [`${APPS}/galleon-steam.sh`]: '755'
  }
}

describe('install.sh', () => {
  test('a nightly install on the handheld puts the arm64 image, the script and a valid entry in place', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    const run = await install(m, ['--nightly'])
    assert.equal(run.status, 0, run.stderr)

    assert.deepEqual(tree(m.home), installed('Galleon-arm64.AppImage'))
    assert.equal(
      readFileSync(join(m.home, APPS, 'Galleon-arm64.AppImage'), 'utf8'),
      '#!/bin/sh\necho arm64 n1\n'
    )
    assert.deepEqual(readFileSync(join(m.home, APPS, 'galleon-steam.sh')), STEAM_SCRIPT)
    assert.deepEqual(
      readFileSync(join(m.home, MENU, `${APP_ID}.svg`)),
      readFileSync(join(ROOT, 'packaging', 'icon.svg'))
    )

    const entry = join(m.home, MENU, `${APP_ID}.desktop`)
    execFileSync('desktop-file-validate', [entry])
    const lines = readFileSync(entry, 'utf8').split('\n')
    assert.ok(lines.includes('Name=Galleon'))
    assert.ok(lines.includes('Categories=Game;'))
    assert.ok(lines.includes(`Exec="${join(m.home, APPS, 'galleon-steam.sh')}"`))
    assert.ok(lines.includes(`Icon=${join(m.home, MENU, `${APP_ID}.svg`)}`))

    assert.match(run.stdout, /Tick Galleon in the list\. Do not use Browse/)
    assert.deepEqual(readdirSync(m.tmp), [], 'nothing written to TMPDIR')
    assert.equal(existsSync(join(m.home, '..', 'sudo-called')), false)
  })

  test('a second run updates in place and leaves the same files', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    assert.equal((await install(m, ['--nightly'])).status, 0)
    const first = tree(m.home)
    const entry = readFileSync(join(m.home, MENU, `${APP_ID}.desktop`), 'utf8')

    nightly = release('nightly', images('n2'))
    const run = await install(m, ['--nightly'])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(tree(m.home), first)
    assert.equal(readFileSync(join(m.home, MENU, `${APP_ID}.desktop`), 'utf8'), entry)
    assert.equal(
      readFileSync(join(m.home, APPS, 'Galleon-arm64.AppImage'), 'utf8'),
      '#!/bin/sh\necho arm64 n2\n'
    )
  })

  test('the default is the newest stable release, through the latest redirect', async () => {
    stable = release('v1.0.0', images('v1'))
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    requests.length = 0
    const run = await install(m, [])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(
      readFileSync(join(m.home, APPS, 'Galleon-arm64.AppImage'), 'utf8'),
      '#!/bin/sh\necho arm64 v1\n'
    )
    assert.ok(requests.includes('/releases/latest/download/SHA256SUMS'))
  })

  test('with no stable release yet it says so and installs nothing', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    const run = await install(m, ['--stable'])
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /could not download SHA256SUMS/)
    assert.deepEqual(tree(m.home), {
      [APPS]: '755',
      '.local': '755',
      '.local/share': '755',
      [MENU]: '755'
    })
  })

  test('on a machine that is not aarch64 it refuses unless --arch x86_64 is given', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('x86_64')
    const refused = await install(m, ['--nightly'])
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /Pass --arch x86_64/)
    assert.deepEqual(tree(m.home), {})

    assert.notEqual((await install(m, ['--nightly', '--arch', 'aarch64'])).status, 0)
    assert.deepEqual(tree(m.home), {})

    const run = await install(m, ['--nightly', '--arch', 'x86_64'])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(tree(m.home), installed('Galleon-x86_64.AppImage'))
  })

  test('a file whose checksum fails is refused, and the installed copy is left as it was', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    assert.equal((await install(m, ['--nightly'])).status, 0)
    const previous = tree(m.home)

    const good = release('nightly', images('n1'))
    nightly = release(
      'nightly',
      { ...images('n1'), 'Galleon-arm64.AppImage': '#!/bin/sh\necho tampered\n' },
      String(good.files.SHA256SUMS)
    )
    const run = await install(m, ['--nightly'])
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /Galleon-arm64\.AppImage does not match its checksum/)
    assert.deepEqual(tree(m.home), previous)
    assert.equal(
      readFileSync(join(m.home, APPS, 'Galleon-arm64.AppImage'), 'utf8'),
      '#!/bin/sh\necho arm64 n1\n'
    )
  })

  test('a file SHA256SUMS does not list is refused', async () => {
    stable = null
    nightly = release('nightly', images('n1'), `${sha256(STEAM_SCRIPT)}  galleon-steam.sh\n`)
    const m = machine('aarch64')
    const run = await install(m, ['--nightly'])
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /Galleon-arm64\.AppImage is not listed/)
    assert.equal(existsSync(join(m.home, APPS, 'Galleon-arm64.AppImage')), false)
    assert.equal(existsSync(join(m.home, MENU, `${APP_ID}.desktop`)), false)
  })

  test('a HOME with characters a desktop entry reserves still gets a valid entry', async () => {
    stable = null
    nightly = release('nightly', images('n1'))
    const m = machine('aarch64')
    const home = join(m.home, 'odd "$name" `x` 100% \\ end')
    mkdirSync(home)
    const run = await install({ ...m, home }, ['--nightly'])
    assert.equal(run.status, 0, run.stderr)
    const entry = join(home, MENU, `${APP_ID}.desktop`)
    execFileSync('desktop-file-validate', [entry])
    // Quoting-level escapes inside the quotes, then string-level backslashes
    // doubled, then `%` doubled: the specification's three layers.
    const exec = join(home, APPS, 'galleon-steam.sh')
      .replace(/\\/g, '\\\\\\\\')
      .replace(/["`$]/g, '\\\\$&')
      .replace(/%/g, '%%')
    assert.ok(readFileSync(entry, 'utf8').split('\n').includes(`Exec="${exec}"`))
  })

  describe('--add-to-steam', () => {
    /** galleon-steam.sh's own needs, which a handheld has and install.sh does not use. */
    const STEAM_SCRIPT_TOOLS = ['dirname', 'readlink']
    /** An image that says how it was started and exits as `~/exit` says. */
    const IMAGE =
      '#!/bin/sh\necho "image started with: $*"\n[ -f "$HOME/exit" ] && exit "$(cat "$HOME/exit")"\nexit 0\n'

    test('runs the installed app with the flag and, when it worked, prints no steps by hand', async () => {
      stable = null
      nightly = release('nightly', { ...images('n1'), 'Galleon-arm64.AppImage': IMAGE })
      const m = machine('aarch64', STEAM_SCRIPT_TOOLS)
      const run = await install(m, ['--nightly', '--add-to-steam'])
      assert.equal(run.status, 0, run.stderr)
      assert.match(run.stdout, /image started with: --add-to-steam$/m)
      assert.doesNotMatch(run.stdout, /Add a Non-Steam Game/)
    })

    test('when the app refuses (Steam running), the install stands, the steps follow and the status is the app’s', async () => {
      stable = null
      nightly = release('nightly', { ...images('n1'), 'Galleon-arm64.AppImage': IMAGE })
      const m = machine('aarch64', STEAM_SCRIPT_TOOLS)
      writeFileSync(join(m.home, 'exit'), '2')
      const run = await install(m, ['--nightly', '--add-to-steam'])
      assert.equal(run.status, 2)
      assert.match(run.stdout, /image started with: --add-to-steam/)
      assert.match(run.stdout, /not in Steam yet/)
      assert.match(run.stdout, /Add a Non-Steam Game/)
      assert.doesNotMatch(run.stdout, /run this again with --add-to-steam/)
      assert.ok(existsSync(join(m.home, APPS, 'Galleon-arm64.AppImage')))
    })

    test('without the flag the app is never started, and the flag is offered', async () => {
      stable = null
      nightly = release('nightly', { ...images('n1'), 'Galleon-arm64.AppImage': IMAGE })
      const m = machine('aarch64', STEAM_SCRIPT_TOOLS)
      const run = await install(m, ['--nightly'])
      assert.equal(run.status, 0, run.stderr)
      assert.doesNotMatch(run.stdout, /image started/)
      assert.match(run.stdout, /run this again with --add-to-steam/)
    })
  })

  test('the script never names sudo', () => {
    assert.doesNotMatch(String(SCRIPT), /\bsudo\b/)
  })
})
