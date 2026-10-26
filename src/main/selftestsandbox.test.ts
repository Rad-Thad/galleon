import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  MISSING_BIOS,
  planSandbox,
  clearStrays,
  prepareSandbox,
  resolveLinks,
  sandboxEnvironment,
  sandboxFolders,
  straysToClear
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

/**
 * `realPath` on a machine where every path is there but an AppImage's portable
 * folders, which only the tests about them put beside it.
 */
function present(path: string): string | null {
  return /\.(home|config)$/.test(path) ? null : path
}

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
  dataDir: '/home/owner/.local/share',
  env: machine()
}

function withRecipe(
  sandbox: EmulatorDescriptor['sandbox'],
  extra: Partial<EmulatorDescriptor> = {}
): EmulatorDescriptor {
  return { ...example, ...extra, sandbox } as EmulatorDescriptor
}

/** A filesystem that cannot clone, such as the owner's BIOS on another disk. */
function noClone(): never {
  throw Object.assign(new Error('no reflinks here'), { code: 'ENOTSUP' })
}

const EMPTY: SandboxRecipe = {
  args: [],
  env: {},
  unset: [],
  needs: [],
  strays: [],
  bios: null,
  needsBios: false,
  files: []
}

function plan(descriptor: EmulatorDescriptor, install = BINARY, system = 'snes') {
  return planSandbox({
    descriptor,
    install,
    system,
    romPath: '/payload/game.sfc',
    home: HOME,
    owner: OWNER,
    realPath: present
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
      needs: [],
      strays: [],
      bios: null,
      needsBios: false,
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
        needs: [],
        strays: [],
        bios: null,
        needsBios: false,
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

  test('is not started when a file the recipe needs cannot be read, link or no link', () => {
    const descriptor = withRecipe(() => ({ ...EMPTY, needs: ['/owner/needed.bin'] }))
    const request = {
      descriptor,
      install: BINARY,
      system: 'snes',
      romPath: '/payload/game.sfc',
      home: HOME,
      owner: OWNER
    }
    assert.deepEqual(
      planSandbox({
        ...request,
        realPath: (path) => (path === '/owner/needed.bin' ? null : present(path))
      }),
      {
        kind: 'skip',
        reason: CANNOT_SANDBOX,
        detail: 'needed-file-missing'
      }
    )
    assert.equal(planSandbox({ ...request, realPath: present }).kind, 'run')
  })

  test('starts no AppImage whose runtime would give it a HOME or config folder of its own', () => {
    const appImage: ResolvedInstall = {
      kind: 'appimage',
      ref: '/home/owner/Applications/Example.AppImage'
    }
    const target = '/home/owner/Applications/Example-1.0.AppImage'
    const request = {
      descriptor: withRecipe(() => EMPTY),
      install: appImage,
      system: 'snes',
      romPath: '/payload/game.sfc',
      home: HOME,
      owner: OWNER
    }
    const resolving = (folder: string | null) => (path: string) =>
      path === folder ? path : path === appImage.ref ? target : present(path)
    for (const folder of [
      `${appImage.ref}.home`,
      `${appImage.ref}.config`,
      `${target}.home`,
      `${target}.config`
    ])
      assert.deepEqual(planSandbox({ ...request, realPath: resolving(folder) }), {
        kind: 'skip',
        reason: CANNOT_SANDBOX,
        detail: 'appimage-portable-folder'
      })
    assert.equal(planSandbox({ ...request, realPath: resolving(null) }).kind, 'run')
  })

  test("removes the recipe's unset variables, but never an XDG root", () => {
    const descriptor = withRecipe(
      () => ({
        args: [],
        env: { KEPT: '1' },
        unset: ['OVERRIDE_DIR', 'FROM_DESCRIPTOR', 'XDG_DATA_HOME'],
        needs: [],
        strays: [],
        bios: null,
        needsBios: false,
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
      needs: [],
      strays: [],
      bios: null,
      needsBios: false,
      files: [{ path: 'config/example.cfg', content: 'x = 1\n' }]
    }))
    const result = plan(descriptor)
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.files, [
      { path: join(HOME, 'sandbox', 'example', 'config', 'example.cfg'), content: 'x = 1\n' }
    ])
  })

  test("starts in the sandbox's root, never the folder Galleon was started in", () => {
    const result = plan(withRecipe(() => EMPTY))
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.cwd, join(HOME, 'sandbox', 'example'))
  })

  test("copies BIOS files into the sandbox's bios folder unless the recipe names another", () => {
    const standard = plan(withRecipe(() => EMPTY))
    assert.equal(standard.kind, 'run')
    if (standard.kind !== 'run') return
    assert.equal(standard.bios, standard.folders.bios)

    const keys = plan(withRecipe(({ folders }) => ({ ...EMPTY, bios: join(folders.data, 'keys') })))
    assert.equal(keys.kind, 'run')
    if (keys.kind !== 'run') return
    assert.equal(keys.bios, join(HOME, 'sandbox', 'example', 'data', 'keys'))
  })

  for (const bios of ['/home/owner/bios', '../../owner/bios']) {
    test(`is not started when the recipe's BIOS folder ${bios} is outside the sandbox`, () => {
      assert.deepEqual(plan(withRecipe(() => ({ ...EMPTY, bios }))), {
        kind: 'skip',
        reason: CANNOT_SANDBOX,
        detail: 'bios-outside-sandbox'
      })
    })
  }

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
        needs: [],
        strays: [],
        bios: null,
        needsBios: false,
        files: [{ path: '../../.config/x', content: '' }]
      })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'a file at the sandbox root itself',
      withRecipe(() => ({
        args: [],
        env: {},
        unset: [],
        needs: [],
        strays: [],
        bios: null,
        needsBios: false,
        files: [{ path: '.', content: '' }]
      })),
      BINARY,
      'file-outside-sandbox'
    ],
    [
      'an absolute file path',
      withRecipe(() => ({
        args: [],
        env: {},
        unset: [],
        needs: [],
        strays: [],
        bios: null,
        needsBios: false,
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
          realPath: present
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

  function retroPlan(
    system = 'snes',
    kind: ResolvedInstall = install,
    realPath: (path: string) => string | null = present
  ) {
    return planSandbox({
      descriptor: retroarch!,
      install: kind,
      system,
      romPath: '/payload/game.sfc',
      home: HOME,
      owner,
      realPath
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

  test('names the temporary folder its start-up makes outside the sandbox', () => {
    const result = retroPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.strays, ['/tmp/retroarch-tmp'])
  })

  test("is not started when the owner's core file is missing", () => {
    const core = join(ownerCores, 'snes9x_libretro.so')
    const seen: string[] = []
    const missingCore = (path: string): string | null => {
      seen.push(path)
      return path === core ? null : path
    }
    assert.deepEqual(retroPlan('snes', install, missingCore), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'needed-file-missing'
    })
    assert.ok(seen.includes(core))
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
      realPath: (path) => links[path] ?? present(path)
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

describe("ARMSX2's recipe", () => {
  const armsx2 = emulatorById('armsx2')
  assert.ok(armsx2)
  const appImage: ResolvedInstall = {
    kind: 'appimage',
    ref: '/home/owner/Applications/ARMSX2.AppImage'
  }

  function armsPlan(install: ResolvedInstall = appImage) {
    return planSandbox({
      descriptor: armsx2!,
      install,
      system: 'ps2',
      romPath: '/payload/game.iso',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  /** The settings file as section/key and value, the way ARMSX2 reads it. */
  function settings(files: { path: string; content: string }[], root: string) {
    const file = files.find((f) => f.path === join(root, 'config', 'ARMSX2', 'inis', 'PCSX2.ini'))
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

  test('roots ARMSX2 in the sandbox config by its data path and by XDG_CONFIG_HOME alike', () => {
    const result = armsPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.env.XDG_CONFIG_HOME, result.folders.config)
    assert.deepEqual(result.argv, [
      appImage.ref,
      '-datapath',
      result.folders.config,
      '-batch',
      '-fullscreen',
      '-nogui',
      '--',
      '/payload/game.iso'
    ])
  })

  test('finds BIOS files, memory cards and states in the sandbox and opens no setup wizard', () => {
    const result = armsPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(settings(result.files, result.folders.root), {
      // Without the version ARMSX2 resets the file and runs its wizard.
      'UI/SettingsVersion': '1',
      'UI/SetupWizardIncomplete': 'false',
      'Folders/Bios': result.folders.bios,
      'Folders/MemoryCards': result.folders.saves,
      'Folders/Savestates': result.folders.states
    })
  })

  test('needs a BIOS dump to start', () => {
    const result = armsPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.needsBios, true)
  })

  test('is not started as a binary', () => {
    assert.deepEqual(armsPlan({ kind: 'binary', ref: '/usr/bin/armsx2-qt' }), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'no-recipe'
    })
  })
})

describe("Eden's recipe", () => {
  const eden = emulatorById('eden')
  assert.ok(eden)
  const appImage: ResolvedInstall = {
    kind: 'appimage',
    ref: '/home/owner/Applications/Eden-Linux-aarch64.AppImage'
  }
  const ownerKeys = '/home/owner/.local/share/eden/keys/prod.keys'

  function edenPlan(
    install: ResolvedInstall = appImage,
    readable: (path: string) => boolean = () => true,
    owner: SandboxContext['owner'] = OWNER
  ) {
    return planSandbox({
      descriptor: eden!,
      install,
      system: 'switch',
      romPath: '/payload/game.nro',
      home: HOME,
      owner,
      realPath: (path) => (readable(path) ? present(path) : null)
    })
  }

  /** The settings file as section/key and value, the way Eden's ini reader takes it. */
  function settings(files: { path: string; content: string }[], root: string) {
    const file = files.find((f) => f.path === join(root, 'config', 'eden', 'qt-config.ini'))
    assert.ok(file)
    const read: Record<string, string> = {}
    let section = ''
    for (const line of file.content.split('\n')) {
      const header = /^\[(\w+)\]$/.exec(line)
      if (header) section = header[1]
      const entry = /^([\w\\]+)=(.*)$/.exec(line)
      if (entry) read[`${section}/${entry[1]}`] = entry[2]
    }
    return read
  }

  test('starts in the sandbox, which holds no portable user folder, fullscreen on the game', () => {
    const result = edenPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.cwd, result.folders.root)
    assert.ok(result.files.every((f) => !f.path.startsWith(join(result.cwd, 'user'))))
    assert.deepEqual(result.argv, [appImage.ref, '-f', '-g', '/payload/game.nro'])
    assert.equal(result.env.XDG_DATA_HOME, result.folders.data)
    assert.equal(result.env.XDG_CONFIG_HOME, result.folders.config)
  })

  test('takes copies of the owner keys where Eden reads them, below XDG_DATA_HOME', () => {
    const result = edenPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.bios, join(result.env.XDG_DATA_HOME, 'eden', 'keys'))
  })

  test('asks nothing before it closes and checks for no update', () => {
    const result = edenPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(settings(result.files, result.folders.root), {
      'UI/confirmStop\\default': 'false',
      // Eden's ConfirmStop::Ask_Never.
      'UI/confirmStop': '2',
      'UI/check_for_updates\\default': 'false',
      'UI/check_for_updates': 'false'
    })
  })

  test("is not started without the owner's prod.keys", () => {
    assert.deepEqual(
      edenPlan(appImage, (path) => path !== ownerKeys),
      { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'needed-file-missing' }
    )
    assert.equal(edenPlan(appImage, () => true, { ...OWNER, dataDir: null }).kind, 'skip')
  })

  test('is not started as a binary or a flatpak', () => {
    assert.equal(edenPlan({ kind: 'binary', ref: '/usr/bin/eden' }).kind, 'skip')
    assert.equal(edenPlan({ kind: 'flatpak', ref: 'dev.eden_emu.eden' }).kind, 'skip')
  })
})

describe("shadPS4's recipe", () => {
  const shadps4 = emulatorById('shadps4')
  assert.ok(shadps4)
  const appImage: ResolvedInstall = {
    kind: 'appimage',
    ref: '/home/owner/Applications/Shadps4-sdl.AppImage'
  }

  function shadPlan(install: ResolvedInstall = appImage) {
    return planSandbox({
      descriptor: shadps4!,
      install,
      system: 'ps4',
      romPath: '/payload/game/eboot.bin',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  test('starts in the sandbox, which holds no portable user folder, with its data below XDG_DATA_HOME', () => {
    const result = shadPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.cwd, result.folders.root)
    assert.equal(result.env.XDG_DATA_HOME, result.folders.data)
    assert.deepEqual(result.files, [])
    assert.deepEqual(result.argv, [appImage.ref, '-f', 'true', '/payload/game/eboot.bin'])
  })

  test('is not started as a binary or a flatpak', () => {
    assert.equal(shadPlan({ kind: 'binary', ref: '/usr/bin/shadps4' }).kind, 'skip')
    assert.equal(shadPlan({ kind: 'flatpak', ref: 'net.shadps4.shadPS4' }).kind, 'skip')
  })
})

describe("Dolphin's recipe", () => {
  const dolphin = emulatorById('dolphin')
  assert.ok(dolphin)
  const binary: ResolvedInstall = { kind: 'binary', ref: '/usr/bin/dolphin-emu' }

  function dolphinPlan(install: ResolvedInstall = binary) {
    return planSandbox({
      descriptor: dolphin!,
      install,
      system: 'gc',
      romPath: '/payload/hello.dol',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  test('gives Dolphin a user folder in the sandbox, where XDG_DATA_HOME would lead it', () => {
    const result = dolphinPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const user = join(result.env.XDG_DATA_HOME, 'dolphin-emu')
    assert.ok(user.startsWith(result.folders.root + '/'))
    assert.deepEqual(result.argv, [
      binary.ref,
      '-u',
      user,
      '-b',
      '-C',
      'Dolphin.Display.Fullscreen=True',
      '-e',
      '/payload/hello.dol'
    ])
    assert.equal(result.needsBios, false)
  })

  test('answers the usage-statistics question in the user folder, so no window asks it', () => {
    const result = dolphinPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const path = join(result.folders.data, 'dolphin-emu', 'Config', 'Dolphin.ini')
    const file = result.files.find((f) => f.path === path)
    assert.ok(file)
    assert.deepEqual(file.content.split('\n'), [
      '[Analytics]',
      'PermissionAsked = True',
      'Enabled = False',
      ''
    ])
  })

  test('is not started as the flatpak', () => {
    assert.deepEqual(dolphinPlan({ kind: 'flatpak', ref: 'org.DolphinEmu.dolphin-emu' }), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'flatpak-install'
    })
  })
})

describe("PPSSPP's recipe", () => {
  const ppsspp = emulatorById('ppsspp')
  assert.ok(ppsspp)
  const binary: ResolvedInstall = { kind: 'binary', ref: '/usr/bin/PPSSPPSDL' }

  function ppssppPlan(install: ResolvedInstall = binary) {
    return planSandbox({
      descriptor: ppsspp!,
      install,
      system: 'psp',
      romPath: '/payload/hello.pbp',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  test('keeps the memory stick in the sandbox, where XDG_CONFIG_HOME leads PPSSPP', () => {
    const result = ppssppPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.ok(result.env.XDG_CONFIG_HOME.startsWith(result.folders.root + '/'))
    assert.deepEqual(result.argv, [
      binary.ref,
      '--fullscreen',
      '--pause-menu-exit',
      '/payload/hello.pbp'
    ])
    assert.deepEqual(result.files, [])
    assert.equal(result.needsBios, false)
  })

  test('is not started as the flatpak', () => {
    assert.deepEqual(ppssppPlan({ kind: 'flatpak', ref: 'org.ppsspp.PPSSPP' }), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'flatpak-install'
    })
  })
})

describe("Flycast's recipe", () => {
  const flycast = emulatorById('flycast')
  assert.ok(flycast)
  const binary: ResolvedInstall = { kind: 'binary', ref: '/usr/bin/flycast' }

  function flycastPlan(install: ResolvedInstall = binary) {
    return planSandbox({
      descriptor: flycast!,
      install,
      system: 'dreamcast',
      romPath: '/payload/hello.cdi',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  test('writes its own emu.cfg where Flycast reads it first, with the window fullscreen', () => {
    const result = flycastPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.argv, [binary.ref, '/payload/hello.cdi'])
    assert.deepEqual(result.files, [
      {
        path: join(result.env.XDG_CONFIG_HOME, 'flycast', 'emu.cfg'),
        content: '[window]\nfullscreen = yes\n'
      }
    ])
  })

  test('takes copies of the owner BIOS into its data folder and no BIOS folder of the owner', () => {
    const result = flycastPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.equal(result.bios, join(result.env.XDG_DATA_HOME, 'flycast'))
    assert.ok(result.unset.includes('FLYCAST_BIOS_PATH'))
    assert.equal(result.needsBios, false)
  })

  test('searches no inherited data or config folder, where a VMU found would be moved away', () => {
    const result = flycastPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    const env = sandboxEnvironment(result, {
      PATH: '/usr/bin',
      XDG_DATA_DIRS: '/home/owner/.local/share/flatpak/exports/share:/usr/share',
      XDG_CONFIG_DIRS: '/home/owner/.config/xdg:/etc/xdg',
      FLYCAST_BIOS_PATH: '/home/owner/bios'
    })
    assert.equal(env.XDG_DATA_DIRS, undefined)
    assert.equal(env.XDG_CONFIG_DIRS, undefined)
    assert.equal(env.FLYCAST_BIOS_PATH, undefined)
    assert.equal(env.XDG_DATA_HOME, result.folders.data)
  })

  test('is not started as the flatpak', () => {
    assert.deepEqual(flycastPlan({ kind: 'flatpak', ref: 'org.flycast.Flycast' }), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'flatpak-install'
    })
  })
})

describe("melonDS's recipe", () => {
  const melonds = emulatorById('melonds')
  assert.ok(melonds)
  const appImage: ResolvedInstall = {
    kind: 'appimage',
    ref: '/home/owner/Applications/melonDS.AppImage'
  }

  function melonPlan(install: ResolvedInstall = appImage) {
    return planSandbox({
      descriptor: melonds!,
      install,
      system: 'nds',
      romPath: '/payload/hello.nds',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
  }

  test('starts the AppImage fullscreen on the ROM, its config folder the sandbox config', () => {
    const result = melonPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    assert.deepEqual(result.argv, [appImage.ref, '-f', '/payload/hello.nds'])
    assert.equal(result.env.XDG_CONFIG_HOME, result.folders.config)
  })

  test('writes no melonDS.toml, so saves follow the ROM and no BIOS dump is asked for', () => {
    const result = melonPlan()
    assert.equal(result.kind, 'run')
    if (result.kind !== 'run') return
    // An empty config folder is melonDS's defaults: no save folder, external BIOS off.
    assert.deepEqual(result.files, [])
    assert.equal(result.needsBios, false)
  })

  test('is not started as a binary, which could have a portable folder beside it', () => {
    assert.deepEqual(melonPlan({ kind: 'binary', ref: '/usr/bin/melonDS' }), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'no-recipe'
    })
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
      realPath: present
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
      needs: [],
      strays: [],
      bios: null,
      needsBios: false,
      files: [{ path: 'config/example/example.cfg', content: 'x = 1\n' }]
    })
    assert.deepEqual(prepareSandbox(result, null), { kind: 'ready', biosFiles: 0 })
    for (const dir of [...Object.values(result.folders), ...Object.values(result.env)]) {
      assert.ok(existsSync(dir), dir)
    }
    const cfg = join(result.folders.config, 'example', 'example.cfg')
    assert.equal(readFileSync(cfg, 'utf8'), 'x = 1\n')
    assert.ok(!existsSync(`${cfg}.part`))
  })

  test("gives the sandbox its own copy of the owner's BIOS files, nested folders too", () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'scph5501.bin'), 'bios')
    mkdirSync(join(owner, 'dc'))
    writeFileSync(join(owner, 'dc', 'dc_boot.bin'), 'dc')
    const result = ready(home)

    assert.deepEqual(prepareSandbox(result, owner), { kind: 'ready', biosFiles: 2 })
    const copy = join(result.folders.bios, 'scph5501.bin')
    assert.ok(!lstatSync(copy).isSymbolicLink())
    assert.equal(readFileSync(copy, 'utf8'), 'bios')
    assert.equal(readFileSync(join(result.folders.bios, 'dc', 'dc_boot.bin'), 'utf8'), 'dc')
  })

  test("copies the owner's BIOS files into the folder the recipe names", () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'prod.keys'), 'keys')
    const result = ready(home, { ...EMPTY, bios: 'data/emu/keys' })

    assert.deepEqual(prepareSandbox(result, owner), { kind: 'ready', biosFiles: 1 })
    assert.equal(
      readFileSync(join(result.folders.data, 'emu', 'keys', 'prod.keys'), 'utf8'),
      'keys'
    )
    assert.ok(!existsSync(join(result.folders.bios, 'prod.keys')))
  })

  test("an emulator writing beside its BIOS never reaches the owner's file", () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'dc_nvmem.bin'), 'owner')
    const result = ready(home)
    prepareSandbox(result, owner)
    writeFileSync(join(result.folders.bios, 'dc_nvmem.bin'), 'sandbox')
    assert.equal(readFileSync(join(owner, 'dc_nvmem.bin'), 'utf8'), 'owner')
  })

  test('a clone costs none of the copy budget', () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'a.bin'), 'aaaa')
    writeFileSync(join(owner, 'b.bin'), 'bbbb')
    const reflink = (source: string, target: string): void =>
      copyFileSync(source, target, constants.COPYFILE_EXCL)
    assert.deepEqual(prepareSandbox(ready(home), owner, reflink, 0), {
      kind: 'ready',
      biosFiles: 2
    })
  })

  test('where nothing can be cloned, copies stay within the budget or the launch is skipped', () => {
    const owner = scratch()
    writeFileSync(join(owner, 'a.bin'), 'aaaa')
    writeFileSync(join(owner, 'b.bin'), 'bbbb')
    assert.deepEqual(prepareSandbox(ready(scratch()), owner, noClone, 8), {
      kind: 'ready',
      biosFiles: 2
    })
    assert.deepEqual(prepareSandbox(ready(scratch()), owner, noClone, 7), {
      kind: 'skip',
      reason: CANNOT_SANDBOX,
      detail: 'bios-too-large'
    })
  })

  test('a second start of the same emulator keeps the copies it has, written to or not', () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'gba_bios.bin'), 'bios')
    const result = ready(home)
    assert.deepEqual(prepareSandbox(result, owner), { kind: 'ready', biosFiles: 1 })
    writeFileSync(join(result.folders.bios, 'gba_bios.bin'), 'written')
    assert.deepEqual(prepareSandbox(result, owner, noClone, 0), { kind: 'ready', biosFiles: 0 })
    assert.equal(readFileSync(join(result.folders.bios, 'gba_bios.bin'), 'utf8'), 'written')
  })

  test("a link to the owner's file left in the sandbox is replaced by a copy", () => {
    const home = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'scph5501.bin'), 'bios')
    const result = ready(home)
    mkdirSync(result.folders.bios, { recursive: true })
    const copy = join(result.folders.bios, 'scph5501.bin')
    symlinkSync(join(owner, 'scph5501.bin'), copy)

    assert.deepEqual(prepareSandbox(result, owner), { kind: 'ready', biosFiles: 1 })
    assert.ok(!lstatSync(copy).isSymbolicLink())
    writeFileSync(copy, 'sandbox')
    assert.equal(readFileSync(join(owner, 'scph5501.bin'), 'utf8'), 'bios')
  })

  test('stops descending into BIOS folders past its depth', () => {
    const home = scratch()
    const owner = scratch()
    const deep = join(owner, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'too-deep.bin'), 'x')
    writeFileSync(join(owner, 'a', 'b', 'c', 'kept.bin'), 'x')
    assert.deepEqual(prepareSandbox(ready(home), owner), { kind: 'ready', biosFiles: 1 })
  })

  test('an emulator that needs a BIOS is skipped as missing-bios when none reached the sandbox', () => {
    const needs = { ...EMPTY, needsBios: true }
    const missing = { kind: 'skip', reason: MISSING_BIOS, detail: 'no-bios-files' }
    assert.deepEqual(prepareSandbox(ready(scratch(), needs), null), missing)
    assert.deepEqual(prepareSandbox(ready(scratch(), needs), scratch()), missing)
    const nested = scratch()
    mkdirSync(join(nested, 'ps2', 'empty'), { recursive: true })
    assert.deepEqual(prepareSandbox(ready(scratch(), needs), nested), missing)
    // A link the sandbox holds is not a dump of its own.
    const linked = ready(scratch(), needs)
    const elsewhere = join(scratch(), 'scph39001.bin')
    writeFileSync(elsewhere, 'bios')
    mkdirSync(linked.folders.bios, { recursive: true })
    symlinkSync(elsewhere, join(linked.folders.bios, 'scph39001.bin'))
    assert.deepEqual(prepareSandbox(linked, null), missing)
  })

  test('an emulator that needs a BIOS starts with a dump of the owner, or the copy it kept', () => {
    const needs = { ...EMPTY, needsBios: true }
    const owner = scratch()
    mkdirSync(join(owner, 'ps2'))
    writeFileSync(join(owner, 'ps2', 'scph39001.bin'), 'bios')
    const result = ready(scratch(), needs)
    assert.deepEqual(prepareSandbox(result, owner), { kind: 'ready', biosFiles: 1 })
    assert.deepEqual(prepareSandbox(result, null), { kind: 'ready', biosFiles: 0 })
  })

  test('an emulator that needs no BIOS starts without one', () => {
    assert.deepEqual(prepareSandbox(ready(scratch()), scratch()), { kind: 'ready', biosFiles: 0 })
  })

  test('a missing BIOS folder copies nothing', () => {
    const home = scratch()
    assert.deepEqual(prepareSandbox(ready(home), join(home, 'nowhere')), {
      kind: 'ready',
      biosFiles: 0
    })
  })
})

describe('stray folders', () => {
  function strayPlan(strays: string[]) {
    const result = planSandbox({
      descriptor: withRecipe(() => ({ ...EMPTY, strays })),
      install: BINARY,
      system: 'snes',
      romPath: '/payload/game.sfc',
      home: HOME,
      owner: OWNER,
      realPath: present
    })
    if (result.kind !== 'run') throw new Error('expected a plan')
    return result
  }

  test('the plan keeps only absolute stray paths', () => {
    assert.deepEqual(strayPlan(['/tmp/emu-tmp', 'relative/tmp']).strays, ['/tmp/emu-tmp'])
  })

  test("only a stray folder that is not there before the start is the run's to clear", () => {
    const result = strayPlan(['/tmp/was-there', '/tmp/new'])
    assert.deepEqual(
      straysToClear(result, (path) => path === '/tmp/was-there'),
      ['/tmp/new']
    )
  })

  test('clears an empty stray folder and leaves one with something in it', () => {
    const dir = scratch()
    const empty = join(dir, 'empty-tmp')
    const used = join(dir, 'used-tmp')
    mkdirSync(empty)
    mkdirSync(used)
    writeFileSync(join(used, 'file'), 'x')
    assert.deepEqual(clearStrays([empty, used, join(dir, 'never-made')]), [empty])
    assert.ok(!existsSync(empty))
    assert.ok(existsSync(join(used, 'file')))
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
