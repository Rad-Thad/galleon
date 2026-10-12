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
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  EmulatorDescriptor,
  ResolvedInstall,
  SandboxContext,
  SandboxRecipe,
  SaveEnvironment
} from '@config/emulators'
import { EMULATORS, emulatorById } from '@config/emulators'
import { example } from '@config/emulators/example/index.ts'
import {
  CANNOT_SANDBOX,
  planSandbox,
  prepareSandbox,
  resolveLinks,
  sandboxEnvironment,
  sandboxFolders
} from './selftestsandbox.ts'

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

/** The owner's machine as a recipe reads it: these text files and nothing else. */
function machine(files: Record<string, string> = {}): SaveEnvironment {
  return {
    exists: (path) => path in files,
    dirs: () => [],
    files: () => [],
    text: (path) => files[path] ?? null,
    head: () => null,
    newest: () => 0
  }
}

const OWNER: SandboxContext['owner'] = {
  home: '/home/owner',
  configDir: '/home/owner/.config',
  env: machine()
}

function withRecipe(
  sandbox: EmulatorDescriptor['sandbox'],
  extra: Partial<EmulatorDescriptor> = {}
): EmulatorDescriptor {
  return { ...example, ...extra, sandbox } as EmulatorDescriptor
}

const EMPTY: SandboxRecipe = { args: [], env: {}, unset: [], files: [] }

function plan(descriptor: EmulatorDescriptor, install = BINARY, system = 'snes') {
  return planSandbox({
    descriptor,
    install,
    system,
    romPath: '/payload/game.sfc',
    home: HOME,
    owner: OWNER,
    realPath: (path) => path
  })
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
      unset: [],
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
        unset: [],
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

  test("removes the recipe's unset variables, but never an XDG root", () => {
    const descriptor = withRecipe(
      () => ({
        args: [],
        env: { KEPT: '1' },
        unset: ['OVERRIDE_DIR', 'FROM_DESCRIPTOR', 'XDG_DATA_HOME'],
        files: []
      }),
      { env: { FROM_DESCRIPTOR: '1' } }
    )
    const result = plan(descriptor)
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.unset, ['OVERRIDE_DIR', 'FROM_DESCRIPTOR'])
    assert.ok(!('FROM_DESCRIPTOR' in result.env))
    assert.equal(result.env.KEPT, '1')
    assert.equal(result.env.XDG_DATA_HOME, result.folders.data)

    const env = sandboxEnvironment(result, {
      PATH: '/usr/bin',
      DISPLAY: ':0',
      OVERRIDE_DIR: '/home/owner/elsewhere',
      XDG_DATA_HOME: '/home/owner/.local/share'
    })
    assert.ok(!('OVERRIDE_DIR' in env))
    assert.equal(env.DISPLAY, ':0')
    assert.equal(env.KEPT, '1')
    assert.equal(env.XDG_DATA_HOME, result.folders.data)
  })

  test('tells the recipe the system, the install and the folders', () => {
    const seen: unknown[] = []
    const descriptor = withRecipe((ctx) => {
      seen.push(ctx)
      return EMPTY
    })
    plan(descriptor, { kind: 'appimage', ref: '/apps/example.AppImage' }, 'nes')
    assert.deepEqual(seen, [
      {
        system: 'nes',
        installKind: 'appimage',
        installRef: '/apps/example.AppImage',
        installTarget: '/apps/example.AppImage',
        folders: sandboxFolders(HOME, 'example'),
        owner: OWNER
      }
    ])
  })

  test('resolves recipe files below the sandbox root', () => {
    const descriptor = withRecipe(() => ({
      args: [],
      env: {},
      unset: [],
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
      withRecipe(() => ({
        args: [],
        env: {},
        unset: [],
        files: [{ path: '../../.config/x', content: '' }]
      })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'a file at the sandbox root itself',
      withRecipe(() => ({ args: [], env: {}, unset: [], files: [{ path: '.', content: '' }] })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'an absolute file path',
      withRecipe(() => ({
        args: [],
        env: {},
        unset: [],
        files: [{ path: '/etc/x', content: '' }]
      })),
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
          home: HOME,
          owner: OWNER,
          realPath: (path) => path
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

describe("RetroArch's recipe", () => {
  const retroarch = emulatorById('retroarch')
  assert.ok(retroarch)
  const ownerCores = '/home/owner/cores'
  const owner: SandboxContext['owner'] = {
    ...OWNER,
    env: machine({
      '/home/owner/.config/retroarch/retroarch.cfg': `libretro_directory = "${ownerCores}"\n`
    })
  }
  const install: ResolvedInstall = { kind: 'binary', ref: '/usr/bin/retroarch' }

  function retroPlan(system = 'snes', kind: ResolvedInstall = install) {
    return planSandbox({
      descriptor: retroarch!,
      install: kind,
      system,
      romPath: '/payload/game.sfc',
      home: HOME,
      owner,
      realPath: (path) => path
    })
  }

  /** The appended config as key and value, the way RetroArch reads it. */
  function appended(files: { path: string; content: string }[]): Record<string, string> {
    const file = files.find((f) => f.path.endsWith('retroarch-sandbox.cfg'))
    assert.ok(file)
    return Object.fromEntries(
      [...file.content.matchAll(/^(\w+) = "([^"]*)"$/gm)].map(([, key, value]) => [key, value])
    )
  }

  test('starts on a config of its own with the sandbox folders appended, before the game', () => {
    const result = retroPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const root = result.folders.root
    assert.deepEqual(result.argv.slice(0, 5), [
      '/usr/bin/retroarch',
      '--config',
      join(root, 'config', 'retroarch', 'retroarch.cfg'),
      '--appendconfig',
      join(root, 'retroarch-sandbox.cfg')
    ])
    assert.deepEqual(result.argv.slice(5, 7), ['-f', '-L'])
    assert.deepEqual(
      result.files.map((f) => f.path),
      [join(root, 'config', 'retroarch', 'retroarch.cfg'), join(root, 'retroarch-sandbox.cfg')]
    )
  })

  test('writes saves, states and system files into the sandbox and never saves its config', () => {
    const result = retroPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const settings = appended(result.files)
    assert.equal(settings.savefile_directory, result.folders.saves)
    assert.equal(settings.savestate_directory, result.folders.states)
    assert.equal(settings.system_directory, result.folders.bios)
    assert.equal(settings.config_save_on_exit, 'false')
    for (const key of ['savefiles', 'savestates', 'systemfiles', 'screenshots']) {
      assert.equal(settings[`${key}_in_content_dir`], 'false', key)
    }
  })

  test("loads the owner's cores and names no other folder outside the sandbox", () => {
    const result = retroPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const { libretro_directory: cores, ...rest } = appended(result.files)
    assert.equal(cores, ownerCores)
    for (const [key, value] of Object.entries(rest)) {
      if (value === 'false') continue
      assert.ok(value.startsWith(`${result.folders.root}/`), `${key} = ${value}`)
    }
  })

  test('inherits none of the variables that would override a folder its config names', () => {
    const result = retroPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const session = {
      PATH: '/usr/bin',
      LIBRETRO_DIRECTORY: '/home/owner/cores',
      LIBRETRO_SYSTEM_DIRECTORY: '/home/owner/bios',
      LIBRETRO_CHEATS_DIRECTORY: '/home/owner/cheats',
      LIBRETRO_ASSETS_DIRECTORY: '/home/owner/assets',
      LIBRETRO_AUTOCONFIG_DIRECTORY: '/home/owner/autoconfig',
      LIBRETRO_DATABASE_DIRECTORY: '/home/owner/database',
      LIBRETRO_VIDEO_FILTER_DIRECTORY: '/home/owner/filters',
      LIBRETRO_VIDEO_SHADER_DIRECTORY: '/home/owner/shaders'
    }
    const env = sandboxEnvironment(result, session)
    assert.deepEqual(
      Object.keys(env).filter((name) => name.startsWith('LIBRETRO_')),
      []
    )
  })

  test('is not started for a system with no core, nor as a flatpak', () => {
    assert.deepEqual(retroPlan('switch'), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'no-recipe'
    })
    assert.equal(retroPlan('snes', { kind: 'flatpak', ref: 'org.libretro.RetroArch' }).kind, 'skip')
  })
})

describe("DuckStation's recipe", () => {
  const duckstation = emulatorById('duckstation')
  assert.ok(duckstation)
  const appImage: ResolvedInstall = {
    kind: 'appimage',
    ref: '/home/owner/Applications/DuckStation-arm64.AppImage'
  }

  function duckPlan(
    install: ResolvedInstall = appImage,
    files: Record<string, string> = {},
    links: Record<string, string> = {}
  ) {
    return planSandbox({
      descriptor: duckstation!,
      install,
      system: 'psx',
      romPath: '/payload/game.cue',
      home: HOME,
      owner: { ...OWNER, env: machine(files) },
      realPath: (path) => links[path] ?? path
    })
  }

  /** The settings file as section/key and value, the way DuckStation reads it. */
  function settings(files: { path: string; content: string }[], root: string) {
    const file = files.find((f) => f.path === join(root, 'config', 'duckstation', 'settings.ini'))
    assert.ok(file)
    const read: Record<string, string> = {}
    let section = ''
    for (const line of file.content.split('\n')) {
      const header = /^\[(\w+)\]$/.exec(line)
      if (header) section = header[1]
      const entry = /^(\w+) = (.*)$/.exec(line)
      if (entry) read[`${section}/${entry[1]}`] = entry[2]
    }
    return read
  }

  test('roots DuckStation in the sandbox config, which XDG_CONFIG_HOME names', () => {
    const result = duckPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.env.XDG_CONFIG_HOME, result.folders.config)
    assert.deepEqual(result.argv, [
      appImage.ref,
      '-batch',
      '-fullscreen',
      '-nogui',
      '--',
      '/payload/game.cue'
    ])
  })

  test('finds BIOS files, memory cards and states in the sandbox and asks nothing on start', () => {
    const result = duckPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(settings(result.files, result.folders.root), {
      'Main/SetupWizardIncomplete': 'false',
      'Main/NoDesktopFile': 'true',
      'BIOS/SearchDirectory': result.folders.bios,
      'MemoryCards/Directory': result.folders.saves,
      'Folders/SaveStates': result.folders.states
    })
  })

  for (const marker of ['portable.txt', 'settings.ini']) {
    test(`is not started with ${marker} beside the AppImage`, () => {
      assert.deepEqual(duckPlan(appImage, { [`/home/owner/Applications/${marker}`]: '' }), {
        kind: 'skip',
        reason: CANNOT_SANDBOX,
        detail: 'no-recipe'
      })
    })
  }

  const linked: ResolvedInstall = { kind: 'appimage', ref: '/home/owner/bin/duckstation.AppImage' }
  const target = '/home/owner/Applications/DuckStation-arm64.AppImage'

  test('is not started with a marker beside the AppImage a link leads to', () => {
    assert.deepEqual(
      duckPlan(linked, { '/home/owner/Applications/portable.txt': '' }, { [linked.ref]: target }),
      { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'no-recipe' }
    )
  })

  test('is not started with a marker beside the link either', () => {
    assert.deepEqual(
      duckPlan(linked, { '/home/owner/bin/settings.ini': '' }, { [linked.ref]: target }),
      { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'no-recipe' }
    )
  })

  test('starts through the link when neither folder has a marker', () => {
    const result = duckPlan(linked, {}, { [linked.ref]: target })
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.argv[0], linked.ref)
  })

  test('is not started when the AppImage cannot be read', () => {
    assert.deepEqual(
      planSandbox({
        descriptor: duckstation!,
        install: appImage,
        system: 'psx',
        romPath: '/payload/game.cue',
        home: HOME,
        owner: OWNER,
        realPath: () => null
      }),
      { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'install-unreadable' }
    )
  })

  test('is not started as a binary or a flatpak', () => {
    assert.equal(duckPlan({ kind: 'binary', ref: '/usr/bin/duckstation-qt' }).kind, 'skip')
    assert.equal(duckPlan({ kind: 'flatpak', ref: 'org.duckstation.DuckStation' }).kind, 'skip')
  })
})

describe('prepareSandbox', () => {
  function ready(home: string, recipe: SandboxRecipe = EMPTY) {
    const result = planSandbox({
      descriptor: withRecipe(() => recipe),
      install: BINARY,
      system: 'snes',
      romPath: '/payload/game.sfc',
      home,
      owner: OWNER,
      realPath: (path) => path
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
      unset: [],
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

describe('resolveLinks', () => {
  test('follows a chain of links to the file and leaves a file as it is', () => {
    const dir = scratch()
    const file = join(dir, 'DuckStation-arm64.AppImage')
    writeFileSync(file, '')
    symlinkSync(file, join(dir, 'first'))
    symlinkSync(join(dir, 'first'), join(dir, 'second'))
    assert.equal(resolveLinks(join(dir, 'second')), file)
    assert.equal(resolveLinks(file), file)
  })

  test('answers null for a dangling link or a missing file', () => {
    const dir = scratch()
    symlinkSync(join(dir, 'gone'), join(dir, 'dangling'))
    assert.equal(resolveLinks(join(dir, 'dangling')), null)
    assert.equal(resolveLinks(join(dir, 'missing')), null)
  })
})
