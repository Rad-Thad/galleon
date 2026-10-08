import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emulatorById } from '@config/emulators'
import type { EmulatorState, ResolvedInstall } from '@config/emulators'
import type { InstalledRom, RommRom } from '@shared/types'
import type { RomMixApp } from './app.ts'
import { launchContext, launcherKey, launchOptions, romFor, saveContext } from './gamecontext.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'
import { RommError } from './romm/index.ts'

/**
 * The variant a launch runs, which is the one a save has to be filed under.
 *
 * `game:launch` and `saveContext` are written in different files and reach the
 * emulator by different routes, and both read `LaunchOptions.effective`. What
 * that field is worth is the whole of this: handed nothing, a descriptor falls
 * back to the head of its own table — the one row a machine may not have — so a
 * push goes looking for the session's save under an emulator that never ran,
 * finds nothing, and settles the unsent record as though there were nothing to
 * send. The save is on disk the whole time, under the emulator that wrote it.
 *
 * EmuDeck's Switch table is the case that makes it concrete: four emulators are
 * listed, most people have installed one, and the head of the table is not
 * usually theirs.
 */

const roots: string[] = []
const realHome = process.env.GALLEON_HOME
// The calls below log, and the log goes wherever the root is: a scratch one,
// so nothing lands in the RomMix folder of whoever runs the tests.
const logRoot = mkdtempSync(join(tmpdir(), 'rommix-gamecontext-test-'))
roots.push(logRoot)
process.env.GALLEON_HOME = logRoot
after(() => {
  log.close()
  if (realHome === undefined) delete process.env.GALLEON_HOME
  else process.env.GALLEON_HOME = realHome
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** A launchers directory holding exactly these scripts. */
function launchers(...scripts: string[]): ResolvedInstall {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-launch-variant-test-'))
  roots.push(dir)
  for (const script of scripts) writeFileSync(join(dir, script), '#!/bin/bash\n')
  return { kind: 'scripts', ref: dir }
}

/** EmuDeck as this machine has it, with `install` deciding what is offered. */
function emudeckWith(install: ResolvedInstall): EmulatorState {
  const descriptor = emulatorById('emudeck')!
  return { id: descriptor.id, name: descriptor.name, install } as EmulatorState
}

/** Only the part of the app `launchOptions` reads. */
function appRecording(systemLaunchers: Record<string, string>): RomMixApp {
  return { store: { settings: { systemLaunchers } } } as unknown as RomMixApp
}

test('with nothing recorded, the launch runs the first option this machine has', () => {
  // Not the first in the descriptor, which is Eden. Anything resolving the save
  // from the table rather than from here files it under an emulator that is not
  // installed.
  const emulator = emudeckWith(launchers('ryujinx.sh'))

  const { chosen, effective } = launchOptions(appRecording({}), emulator, 'switch')

  assert.equal(chosen, null)
  assert.equal(effective, 'ryujinx')
  assert.notEqual(effective, emulatorById('emudeck')!.variants?.('switch')[0]?.id)
})

test('a recorded choice is what runs, and so what the save is filed under', () => {
  const emulator = emudeckWith(launchers('citron.sh', 'ryujinx.sh'))
  const recorded = { [launcherKey('emudeck', 'switch')]: 'ryujinx' }

  const { chosen, effective } = launchOptions(appRecording(recorded), emulator, 'switch')

  assert.equal(chosen, 'ryujinx')
  assert.equal(effective, 'ryujinx')
})

test('a choice whose launcher has gone is asked again rather than substituted', () => {
  // The recorded emulator was uninstalled. `chosen` going null is what puts the
  // question back; `effective` still has to name something runnable, because
  // the save path is resolved from it whether or not anybody is asked.
  const emulator = emudeckWith(launchers('citron.sh'))
  const recorded = { [launcherKey('emudeck', 'switch')]: 'ryujinx' }

  const { chosen, effective, options } = launchOptions(appRecording(recorded), emulator, 'switch')

  assert.equal(chosen, null)
  assert.equal(effective, 'citron')
  assert.deepEqual(
    options.map((option) => option.id),
    ['citron']
  )
})

test('an emulator that claims the system with nothing installed for it says so', () => {
  // Distinct from an emulator with no variants at all, which is most of them.
  // `effective` is undefined here and the launch is refused by name rather than
  // exec'ing a script that is not there.
  const emulator = emudeckWith(launchers('dolphin-emu.sh'))

  const { effective, noLauncher } = launchOptions(appRecording({}), emulator, 'switch')

  assert.equal(effective, undefined)
  assert.equal(noLauncher, true)
})

/**
 * The part of the app the game calls read, answering as the test says.
 *
 * `rom` is what the server does when asked; `cached` is what was written down
 * at install time; `installed` is the copy the emulator in charge would run,
 * and `stored` the index entry whatever emulator it belongs to.
 */
function gameApp(
  parts: {
    rom?: () => Promise<RommRom>
    cached?: RommRom | null
    installed?: InstalledRom | null
    stored?: InstalledRom | null
    emulator?: EmulatorState | null
    remember?: () => Promise<void>
  } = {}
): { app: RomMixApp; remembered: number[]; probed: () => number } {
  const remembered: number[] = []
  let probes = 0
  const app = {
    client: { rom: parts.rom ?? (async () => game) },
    offline: { game: async () => parts.cached ?? null },
    library: {
      installedNow: () => parts.installed ?? null,
      remember: async (rom: RommRom) => {
        remembered.push(rom.id)
        await parts.remember?.()
      },
      launchTarget: async (entry: InstalledRom) => `${entry.path}/game.nsp`
    },
    store: {
      getInstalled: () => parts.stored ?? parts.installed ?? undefined,
      settings: { systemLaunchers: {} }
    },
    ensureEmulators: async () => {
      probes += 1
    },
    activeEmulator: () =>
      parts.emulator === undefined ? emudeckWith(launchers('ryujinx.sh')) : parts.emulator
  } as unknown as RomMixApp
  return { app, remembered, probed: () => probes }
}

const game = { id: 7, name: 'From the server' } as RommRom
const saved = { id: 7, name: 'From the disk' } as RommRom
const onDisk = { romId: 7, system: 'switch', path: '/roms/switch/game' } as InstalledRom

describe('the ROM a call about a game works from', () => {
  test("is the server's answer whenever there is one", async () => {
    const { app } = gameApp({ cached: saved })

    assert.equal((await romFor(app, 7)).name, 'From the server')
  })

  test('is written down again on the way past, for a game on this disk', async () => {
    const { app, remembered } = gameApp({ installed: onDisk })

    await romFor(app, 7)

    assert.deepEqual(remembered, [7])
  })

  test('is not written down for a game that is not here', async () => {
    const { app, remembered } = gameApp()

    await romFor(app, 7)

    assert.deepEqual(remembered, [])
  })

  test('still answers when writing it down fails', async () => {
    // A full disk or a missing folder is no reason to refuse the game screen.
    const { app } = gameApp({
      installed: onDisk,
      remember: async () => {
        throw new Error('no room')
      }
    })

    assert.equal((await romFor(app, 7)).name, 'From the server')
  })

  test('is the copy saved at install time when nothing answers', async () => {
    const { app } = gameApp({
      rom: async () => {
        throw new TypeError('fetch failed')
      },
      cached: saved
    })

    assert.equal((await romFor(app, 7)).name, 'From the disk')
  })

  test('is never the saved copy when RomM turned the request down', async () => {
    // A 401 is the sign-in expiring. Served from the cache, the game screen
    // would work while everything else headed for the sign-in form.
    for (const status of [401, 403]) {
      const { app } = gameApp({
        rom: async () => {
          throw new RommError('refused', status)
        },
        cached: saved
      })

      await assert.rejects(romFor(app, 7), (cause: Error) => cause instanceof RommError)
    }
  })

  test('is the failure itself when nothing was saved either', async () => {
    const failure = new TypeError('fetch failed')
    const { app } = gameApp({
      rom: async () => {
        throw failure
      }
    })

    await assert.rejects(romFor(app, 7), (cause) => cause === failure)
  })
})

describe("what syncing a game's saves needs", () => {
  test('the ROM, the emulator, and the file it is handed rather than its folder', async () => {
    const { app, probed } = gameApp({ installed: onDisk })

    const target = await saveContext(app, 7)

    assert.equal(target.rom.name, 'From the server')
    assert.equal(target.system, 'switch')
    assert.equal(target.romPath, '/roms/switch/game/game.nsp')
    // The variant the launch would run, so the save is looked for where the
    // emulator that ran wrote it.
    assert.equal(target.variant, 'ryujinx')
    assert.equal(probed(), 1, 'the emulators should be probed before the index is read')
  })

  test('says so when the game is not downloaded for the emulator in charge', async () => {
    const { app } = gameApp()

    await assert.rejects(saveContext(app, 7), { message: t('error.notDownloadedForEmulator') })
  })

  test('says so when no emulator can run the system', async () => {
    const { app } = gameApp({ installed: onDisk, emulator: null })

    await assert.rejects(saveContext(app, 7), {
      message: t('error.noEmulatorForSystem', { system: 'switch' })
    })
  })
})

describe('what launching a game needs', () => {
  test('the copy on disk and the emulator that will run it', async () => {
    const { app, probed } = gameApp({ installed: onDisk })

    const { installed, emulator } = await launchContext(app, 7)

    assert.equal(installed.path, '/roms/switch/game')
    assert.equal(emulator.id, 'emudeck')
    assert.equal(probed(), 1)
  })

  test('a game downloaded for another emulator is told apart from one never downloaded', async () => {
    const elsewhere = gameApp({ stored: onDisk })
    await assert.rejects(launchContext(elsewhere.app, 7), {
      message: t('error.downloadedForOther')
    })

    const nowhere = gameApp()
    await assert.rejects(launchContext(nowhere.app, 7), { message: t('error.notDownloadedYet') })
  })

  test('says so when no emulator can run the system', async () => {
    const { app } = gameApp({ installed: onDisk, emulator: null })

    await assert.rejects(launchContext(app, 7), {
      message: t('error.noEmulatorForSystem', { system: 'switch' })
    })
  })
})
