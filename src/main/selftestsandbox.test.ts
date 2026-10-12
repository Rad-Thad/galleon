import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorDescriptor, ResolvedInstall, SandboxRecipe } from '@config/emulators'
import { EMULATORS } from '@config/emulators'
import { example } from '@config/emulators/example/index.ts'
import { CANNOT_SANDBOX, planSandbox, prepareSandbox, sandboxFolders } from './selftestsandbox.ts'

/**
 * The self-test's emulator sandbox: what an emulator is started with, which
 * emulators are never started, and what is laid out on disk before a start.
 */

const scratches: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-selftest-sandbox-'))
  scratches.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const BINARY: ResolvedInstall = { kind: 'binary', ref: '/usr/bin/example' }
const HOME = '/test/home'

function withRecipe(
  sandbox: EmulatorDescriptor['sandbox'],
  extra: Partial<EmulatorDescriptor> = {}
): EmulatorDescriptor {
  return { ...example, ...extra, sandbox } as EmulatorDescriptor
}

const EMPTY: SandboxRecipe = { args: [], env: {}, files: [] }

function plan(descriptor: EmulatorDescriptor, install = BINARY, system = 'snes') {
  return planSandbox({ descriptor, install, system, romPath: '/payload/game.sfc', home: HOME })
}

describe('planSandbox', () => {
  test('points every XDG root into the sandbox and starts the program there', () => {
    const result = plan(withRecipe(() => EMPTY))
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const root = join(HOME, 'sandbox', 'example')
    assert.deepEqual(result.folders, sandboxFolders(HOME, 'example'))
    assert.equal(result.folders.root, root)
    assert.deepEqual(result.env, {
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      XDG_STATE_HOME: join(root, 'state'),
      XDG_CACHE_HOME: join(root, 'cache')
    })
    assert.deepEqual(result.argv, ['/usr/bin/example', '/payload/game.sfc'])
  })

  test("places the recipe's arguments right after the program", () => {
    const descriptor = withRecipe(({ folders }) => ({
      args: ['-u', folders.data],
      env: {},
      files: []
    }))
    const result = plan(descriptor, BINARY, 'nes')
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.argv, [
      '/usr/bin/example',
      '-u',
      result.folders.data,
      '--nes',
      '/payload/game.sfc'
    ])
  })

  test("merges the descriptor's and the recipe's env, but never over the XDG roots", () => {
    const descriptor = withRecipe(
      () => ({
        args: [],
        env: { FROM_RECIPE: '1', XDG_CONFIG_HOME: '/home/owner/.config' },
        files: []
      }),
      { env: { FROM_DESCRIPTOR: '1', FROM_RECIPE: 'descriptor' } }
    )
    const result = plan(descriptor)
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.env.FROM_DESCRIPTOR, '1')
    assert.equal(result.env.FROM_RECIPE, '1')
    assert.equal(result.env.XDG_CONFIG_HOME, result.folders.config)
  })

  test('tells the recipe the system, the install kind and the folders', () => {
    const seen: unknown[] = []
    const descriptor = withRecipe((ctx) => {
      seen.push(ctx)
      return EMPTY
    })
    plan(descriptor, { kind: 'appimage', ref: '/apps/example.AppImage' }, 'nes')
    assert.deepEqual(seen, [
      { system: 'nes', installKind: 'appimage', folders: sandboxFolders(HOME, 'example') }
    ])
  })

  test('resolves recipe files below the sandbox root', () => {
    const descriptor = withRecipe(() => ({
      args: [],
      env: {},
      files: [{ path: 'config/example.cfg', content: 'x = 1\n' }]
    }))
    const result = plan(descriptor)
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.files, [
      { path: join(HOME, 'sandbox', 'example', 'config', 'example.cfg'), content: 'x = 1\n' }
    ])
  })

  const refusals: [string, EmulatorDescriptor, ResolvedInstall, string][] = [
    ['an emulator without a recipe', withRecipe(undefined), BINARY, 'no-recipe'],
    ['a recipe that declines the context', withRecipe(() => null), BINARY, 'no-recipe'],
    [
      'a flatpak install',
      withRecipe(() => EMPTY),
      { kind: 'flatpak', ref: 'org.example.Emu' },
      'flatpak-install'
    ],
    [
      'a scripts install',
      withRecipe(() => EMPTY),
      { kind: 'scripts', ref: '/home/owner/Emulation/tools/launchers' },
      'scripts-install'
    ],
    [
      'a file outside the sandbox',
      withRecipe(() => ({ args: [], env: {}, files: [{ path: '../../.config/x', content: '' }] })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'a file at the sandbox root itself',
      withRecipe(() => ({ args: [], env: {}, files: [{ path: '.', content: '' }] })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'an absolute file path',
      withRecipe(() => ({ args: [], env: {}, files: [{ path: '/etc/x', content: '' }] })),
      BINARY,
      'file-outside-sandbox'
    ]
  ]
  for (const [name, descriptor, install, detail] of refusals) {
    test(`never starts ${name}`, () => {
      assert.deepEqual(plan(descriptor, install), { kind: 'skip', reason: CANNOT_SANDBOX, detail })
    })
  }

  test('skips a system the emulator cannot run', () => {
    assert.deepEqual(
      plan(
        withRecipe(() => EMPTY),
        BINARY,
        'psx'
      ),
      {
        kind: 'skip',
        reason: CANNOT_SANDBOX,
        detail: 'unsupported-system'
      }
    )
  })

  test('every registered emulator either has a recipe or is skipped as cannot-sandbox', () => {
    for (const descriptor of EMULATORS) {
      for (const system of descriptor.systems) {
        const result = planSandbox({
          descriptor,
          install: BINARY,
          system,
          romPath: '/payload/game',
          home: HOME
        })
        if (result.kind === 'skip') {
          assert.equal(result.reason, CANNOT_SANDBOX, descriptor.id)
          continue
        }
        for (const path of Object.values(result.folders)) {
          assert.ok(
            path.startsWith(join(HOME, 'sandbox', descriptor.id)),
            `${descriptor.id}: ${path}`
          )
        }
      }
    }
  })
})

describe('prepareSandbox', () => {
  function ready(home: string, recipe: SandboxRecipe = EMPTY) {
    const result = planSandbox({
      descriptor: withRecipe(() => recipe),
      install: BINARY,
      system: 'snes',
      romPath: '/payload/game.sfc',
      home
    })
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') throw new Error('expected a plan')
    return result
  }

  test('makes every folder and writes the recipe files whole', () => {
    const home = scratch()
    const result = ready(home, {
      args: [],
      env: {},
      files: [{ path: 'config/example/example.cfg', content: 'x = 1\n' }]
    })
    assert.equal(prepareSandbox(result, null), 0)
    for (const dir of [...Object.values(result.folders), ...Object.values(result.env)]) {
      assert.ok(existsSync(dir), dir)
    }
    const cfg = join(result.folders.config, 'example', 'example.cfg')
    assert.equal(readFileSync(cfg, 'utf8'), 'x = 1\n')
    assert.ok(!existsSync(`${cfg}.part`))
  })

  test("links the owner's BIOS files, nested folders too, and never copies them", () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'scph5501.bin'), 'bios')
    mkdirSync(join(owner, 'dc'))
    writeFileSync(join(owner, 'dc', 'dc_boot.bin'), 'dc')
    const result = ready(home)

    assert.equal(prepareSandbox(result, owner), 2)
    const link = join(result.folders.bios, 'scph5501.bin')
    assert.ok(lstatSync(link).isSymbolicLink())
    assert.equal(readlinkSync(link), join(owner, 'scph5501.bin'))
    assert.equal(
      readlinkSync(join(result.folders.bios, 'dc', 'dc_boot.bin')),
      join(owner, 'dc', 'dc_boot.bin')
    )
  })

  test('a second start of the same emulator keeps the links it has', () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'gba_bios.bin'), 'bios')
    const result = ready(home)
    assert.equal(prepareSandbox(result, owner), 1)
    assert.equal(prepareSandbox(result, owner), 0)
    assert.ok(lstatSync(join(result.folders.bios, 'gba_bios.bin')).isSymbolicLink())
  })

  test('stops descending into BIOS folders past its depth', () => {
    const home = scratch()
    const owner = scratch()
    const deep = join(owner, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'too-deep.bin'), 'x')
    writeFileSync(join(owner, 'a', 'b', 'c', 'kept.bin'), 'x')
    assert.equal(prepareSandbox(ready(home), owner), 1)
  })

  test('a missing BIOS folder links nothing', () => {
    const home = scratch()
    assert.equal(prepareSandbox(ready(home), join(home, 'nowhere')), 0)
  })
})
