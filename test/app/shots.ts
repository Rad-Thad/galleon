import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SHARED_LIBRARY } from '@shared/types'
import { atHome, standInEmulator, startApp, type App } from './driver.ts'
import { startScenario } from './harness.ts'
import { layoutOffenders, MEASURE_LAYOUT, type Layout } from './layout.ts'
import { startFakeRomm } from './server.ts'

/**
 * Every screen at the Nova's resolution, for the agent to look at.
 *
 * The cloud agent never sees the device, so these pictures are how it checks a
 * layout at 4:3: it opens the PNGs, and CI keeps them as an artifact. Each
 * screen is reached the way a player reaches it, by the driver's presses on
 * the focus engine rather than by a call into the application, so a screen
 * that stops being reachable fails here instead of being photographed from a
 * back door.
 *
 * Each picture is also measured: a control outside the window, cut off, or
 * drawn over another fails its screen and is named by its `data-*` handle (see
 * `layoutOffenders`).
 *
 * `npm run shots:nova` runs this; `-- --subset pr` takes the screens a pull
 * request needs, the full set being the nightly's.
 */

/** The Nova's panel, in CSS pixels at a scale of one. */
const NOVA = { width: 1280, height: 960 }

const OUT = resolve('artifacts', 'shots')

/** Where each application runs. Fixed, because Settings prints it. */
const HOMES = join(tmpdir(), 'galleon-shots')

/** What a pull request photographs. See PLAN.md section 4. */
const PR_SUBSET = new Set(['home', 'library', 'game', 'downloads', 'settings', 'setup'])

interface Taken {
  name: string
  /** Why it could not be photographed, when it could not. */
  failed?: string
}

const subset = process.argv.includes('--subset')
  ? process.argv[process.argv.indexOf('--subset') + 1]
  : 'all'
if (subset !== 'all' && subset !== 'pr') {
  console.error(`shots:nova: unknown subset "${subset}"; use pr, or none for every screen`)
  process.exit(64)
}

/** Whether a screen, or a tab of one, belongs to this run. */
const wanted = (screen: string): boolean => subset === 'all' || PR_SUBSET.has(screen)

const taken: Taken[] = []

/**
 * Let the screen finish drawing, then keep what it shows.
 *
 * Waiting for the images, the spinners and every transition that ends is what
 * makes two runs of the same commit give the same picture: a shot taken while
 * covers are still arriving, or while the highlight is still sliding onto a
 * tab, differs from the next by however far it had got.
 */
async function shoot(app: App, name: string): Promise<void> {
  await app.waitFor(
    `document.querySelector('.spinner') === null &&
     [...document.images].every((image) => image.complete) &&
     document.fonts.status === 'loaded' &&
     document.getAnimations().every((motion) =>
       motion.playState !== 'running' || motion.effect?.getTiming().iterations === Infinity)`,
    `${name} to finish drawing`
  )
  // Two frames, so whatever the last press changed has been painted.
  await app.read(
    `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))`
  )
  writeFileSync(join(OUT, `${name}.png`), await app.screenshot())
  // After the picture, so a screen that does not fit can still be looked at.
  const offenders = layoutOffenders(await app.read<Layout>(MEASURE_LAYOUT))
  if (offenders.length > 0)
    throw new Error(`does not fit ${NOVA.width}x${NOVA.height}:\n    ${offenders.join('\n    ')}`)
  taken.push({ name })
  console.log(`  ${name}.png`)
}

/**
 * Photograph one screen, and carry on to the next if it fails.
 *
 * One broken screen should not cost the pictures of all the others: the run
 * still exits non-zero, and the sheet says which one is missing and why.
 */
async function attempt(name: string, walk: () => Promise<void>): Promise<void> {
  try {
    await walk()
  } catch (cause) {
    const failed = cause instanceof Error ? cause.message : String(cause)
    taken.push({ name, failed })
    console.error(`  ${name}: ${failed}`)
  }
}

/** Step through a screen's tab strip with the shoulder buttons, one shot each. */
async function eachTab(app: App, screen: string): Promise<void> {
  const tabs = await app.read<string[]>(
    `[...document.querySelectorAll('[data-screen="${screen}"] [data-tab]')].map((tab) => tab.dataset.tab)`
  )
  if (tabs.length === 0) return shoot(app, screen)
  for (let index = 0; index < tabs.length; index += 1) {
    if (index > 0) await app.press('TabNext')
    const tab = tabs[index]
    await attempt(`${screen}-${tab}`, async () => {
      await app.waitFor(
        `document.querySelector('[data-screen="${screen}"] [data-tab="${tab}"]')?.dataset.active === 'true'`,
        `the ${tab} tab of ${screen}`
      )
      await shoot(app, `${screen}-${tab}`)
    })
    // The pull request needs the screen, not every tab of it.
    if (subset === 'pr') break
  }
}

/** Settings -> System, reached with the shoulder buttons. */
async function systemTab(app: App): Promise<void> {
  await app.goTo('settings')
  await app.waitFor(`document.querySelector('[data-tab="system"]')`, 'the system tab')
  while (
    !(await app.read<boolean>(
      `document.querySelector('[data-tab="system"]')?.dataset.active === 'true'`
    ))
  )
    await app.press('TabNext')
}

/** Switch the performance overlay from Settings -> System. */
async function perfOverlay(app: App, option: 'on' | 'off'): Promise<void> {
  await systemTab(app)
  await app.choose(`[data-setting="perfOverlay"] [data-option="${option}"]`)
}

/** Every screen of a signed-in Galleon, ending with a game on screen. */
async function signedIn(): Promise<void> {
  const scenario = await startScenario({ viewport: NOVA, home: join(HOMES, 'signed-in') })
  const { app } = scenario
  try {
    await attempt('home', () => shoot(app, 'home'))

    await attempt('library', async () => {
      await app.goTo('library')
      await app.waitFor(`document.querySelector('[data-rom]')`, 'the library to fill')
      await shoot(app, 'library')
    })

    // The Switch game, the one the scenario's stand-in emulator can start.
    await attempt('game', async () => {
      await app.goTo('library')
      await app.choose('[data-rom="3"]')
      await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game page')
      await eachTab(app, 'game')
    })

    for (const screen of ['collections', 'downloads', 'bios', 'emulators'])
      if (wanted(screen))
        await attempt(screen, async () => {
          await app.goTo(screen)
          await app.waitFor(`document.querySelector('[data-screen="${screen}"]')`, screen)
          await shoot(app, screen)
        })

    await attempt('settings', async () => {
      await app.goTo('settings')
      await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'settings')
      await eachTab(app, 'settings')
    })

    // Turned on the way a player does, from Settings -> System, then shown
    // over the library it is most often turned on to measure; off again after,
    // so the shots that follow are of the screens alone.
    if (wanted('perf-overlay'))
      await attempt('perf-overlay', async () => {
        await perfOverlay(app, 'on')
        await app.goTo('library')
        await app.waitFor(`document.querySelector('[data-rom]')`, 'the library to fill')
        await app.waitFor(
          `document.querySelector('[data-perf-overlay]')?.textContent.includes('p99')`,
          'the overlay to measure'
        )
        await shoot(app, 'perf-overlay')
        await perfOverlay(app, 'off')
      })

    // Report a problem, pressed: the section, and the toast naming the zip.
    if (wanted('report'))
      await attempt('report', async () => {
        await systemTab(app)
        await app.choose('[data-action="report-problem"]')
        await app.waitFor(`document.querySelector('.toast')`, 'the report to be named')
        await shoot(app, 'report')
      })

    // The quit dialog, reached with B from the library as a player reaches it,
    // and put away again with B.
    if (wanted('quit'))
      await attempt('quit', async () => {
        await app.goTo('library')
        for (let presses = 0; presses < 4; presses += 1) {
          if (await app.read<boolean>(`!!document.querySelector('.overlay')`)) break
          await app.press('Escape')
        }
        await app.waitFor(
          `document.querySelector('.overlay [data-action="report-problem"]')`,
          'the quit dialog'
        )
        await shoot(app, 'quit')
        await app.press('Escape')
        await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')
      })

    if (wanted('running'))
      await attempt('running', async () => {
        await app.goTo('library')
        await app.choose('[data-rom="3"]')
        await app.choose('[data-action="download"]')
        await app.waitFor(
          `(await window.rommix.library.installed()).some((one) => one.romId === 3)`,
          'the game to arrive'
        )
        await app.choose('[data-action="play"]')
        await app.waitFor(`document.querySelector('.overlay')`, 'the running overlay')
        await shoot(app, 'running')
      })
  } finally {
    await scenario.stop()
  }
}

/** The first page a new player sees, before anything is set up. */
async function setup(): Promise<void> {
  const server = await startFakeRomm()
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    signedOut: true,
    settings: { setupComplete: false },
    viewport: NOVA,
    home: join(HOMES, 'setup')
  })
  try {
    await attempt('setup', async () => {
      await app.waitFor(`document.querySelector('[data-screen="setup"]')`, 'the setup wizard')
      await app.waitFor(
        `document.querySelector('[data-screen="setup"] [data-focused="true"]')`,
        'its first page'
      )
      await shoot(app, 'setup')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
  }
}

/** One page with every picture and its name, for looking at the lot at once. */
function contactSheet(): void {
  const cards = taken
    .map(({ name, failed }) =>
      failed
        ? `<figure class="failed"><figcaption>${name}</figcaption><p>${escape(failed)}</p></figure>`
        : `<figure><a href="${name}.png"><img src="${name}.png" alt="${name}" width="${NOVA.width / 4}" height="${NOVA.height / 4}"></a><figcaption>${name}</figcaption></figure>`
    )
    .join('\n')
  writeFileSync(
    join(OUT, 'index.html'),
    `<!doctype html>
<meta charset="utf-8">
<title>Galleon at ${NOVA.width}x${NOVA.height}</title>
<style>
  body { background: #111; color: #ddd; font: 14px system-ui, sans-serif; margin: 16px; }
  main { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; }
  img { display: block; border: 1px solid #333; }
  .failed { width: ${NOVA.width / 4}px; color: #f88; }
</style>
<h1>Galleon at ${NOVA.width}x${NOVA.height}</h1>
<main>
${cards}
</main>
`
  )
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (one) => `&#${one.charCodeAt(0)};`)
}

/**
 * The library with platforms whose icons the server does not have, which must
 * show their short codes rather than a broken image.
 */
async function iconless(): Promise<void> {
  const scenario = await startScenario({
    viewport: NOVA,
    home: join(HOMES, 'iconless'),
    server: { iconless: true }
  })
  const { app } = scenario
  try {
    await attempt('library-iconless', async () => {
      await app.goTo('library')
      await app.waitFor(`document.querySelector('[data-rom="31"]')`, 'the Wii U game')
      await app.waitFor(
        `[...document.querySelectorAll('img.system-icon')].length === 0`,
        'every icon to fall back'
      )
      const broken = await app.read<string[]>(
        `[...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute('src') ?? '')`
      )
      if (broken.length > 0) throw new Error(`broken images: ${broken.join(', ')}`)
      // The table's short codes, which say both folders resolved to their systems.
      const badges = await app.read<string[]>(
        `[...document.querySelectorAll('.platform-badge')].map((badge) => badge.textContent ?? '')`
      )
      for (const code of ['GC', 'WIIU'])
        if (!badges.includes(code)) throw new Error(`no ${code} badge among ${badges.join(', ')}`)
      await shoot(app, 'library-iconless')
    })
  } finally {
    await scenario.stop()
  }
}

/**
 * The Saves tab of a game whose states stay on this device (M2-15).
 *
 * A Genesis game under RetroArch, whose states `statesSync` keeps local: one
 * this device made and one RomM holds from elsewhere, beside a save that does
 * sync, so the grey badge is seen against the ones that move.
 */
async function localStates(): Promise<void> {
  const server = await startFakeRomm()
  const configHome = join(HOMES, 'states-xdg')
  rmSync(configHome, { recursive: true, force: true })
  const stateDir = join(configHome, 'retroarch', 'states')
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'cavestory.state1'), 'stopped mid-boss')
  server.holdSave({
    romId: 1,
    fileName: 'cavestory.srm',
    emulator: 'genesis_plus_gx',
    content: 'from another device'
  })
  server.holdState({
    romId: 1,
    fileName: 'cavestory.state2',
    emulator: 'genesis_plus_gx',
    content: 'stopped somewhere else'
  })
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      systemEmulators: { genesis: 'retroarch' },
      emulatorPaths: { retroarch: standInEmulator().path }
    },
    env: { XDG_CONFIG_HOME: configHome },
    viewport: NOVA,
    home: join(HOMES, 'states')
  })
  try {
    await attempt('game-saves-states', async () => {
      await atHome(app)
      await app.goTo('library')
      await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the library to fill')
      await app.choose('[data-rom="1"]')
      await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game page')
      await app.choose('[data-action="download"]')
      await app.waitFor(
        `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
        'the game to arrive'
      )
      // Entered again, so the list is read with the game on this device: it is
      // the installed copy that names the emulator whose rule applies.
      await app.goTo('library')
      await app.choose('[data-rom="1"]')
      await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game page')
      await app.choose('[data-tab="saves"]')
      await app.waitFor(
        `[...document.querySelectorAll('.asset-list .status--badge')].filter(
           (one) => one.dataset.state === 'off'
         ).length === 2`,
        'both states marked as not synced'
      )
      // The download's toasts sit over the header; the shot is of the tab.
      await app.waitFor(`!document.querySelector('.toast')`, 'the toasts to go', 20_000)
      await shoot(app, 'game-saves-states')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
  }
}

/**
 * The conflict dialog (M2-16): a save this device and RomM both moved on.
 *
 * RomM holds a newer copy in the shared slot from another device that this
 * device never took, so a push of the local save is refused and the dialog
 * opens with both copies side by side.
 */
async function conflict(): Promise<void> {
  const server = await startFakeRomm({
    devices: [
      {
        id: 'some-other-device',
        name: 'Argosy @ phone',
        hostname: null,
        client_device_identifier: null
      }
    ]
  })
  const configHome = join(HOMES, 'conflict-xdg')
  rmSync(configHome, { recursive: true, force: true })
  const saveDir = join(configHome, 'retroarch', 'saves')
  server.holdSave({
    romId: 1,
    fileName: 'Cave Story (E).srm',
    slot: 'autosave',
    emulator: 'genesis_plus_gx',
    content: 'saved at the Egg Corridor'
  })
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      systemEmulators: { genesis: 'retroarch' },
      emulatorPaths: { retroarch: standInEmulator().path },
      confirmSavePush: false
    },
    env: { XDG_CONFIG_HOME: configHome },
    viewport: NOVA,
    home: join(HOMES, 'conflict')
  })
  try {
    await attempt('game-conflict', async () => {
      await atHome(app)
      await app.goTo('library')
      await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the library to fill')
      await app.choose('[data-rom="1"]')
      await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game page')
      await app.choose('[data-action="download"]')
      await app.waitFor(
        `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
        'the game to arrive'
      )
      mkdirSync(saveDir, { recursive: true })
      writeFileSync(join(saveDir, 'cavestory.srm'), 'saved in the Mimiga Village, further on')
      await app.choose('[data-action="push-saves"]')
      await app.waitFor(`document.querySelector('.overlay [data-conflict]')`, 'the conflict')
      await app.waitFor(`!document.querySelector('.toast')`, 'the toasts to go', 20_000)
      await shoot(app, 'game-conflict')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
  }
}

/**
 * A downloaded game whose SD card is out (M1-10): the page says so in place of
 * Play, and offers nothing that would need the game's files.
 */
async function cardMissing(): Promise<void> {
  const server = await startFakeRomm()
  const path = '/run/media/galleon-shots/NovaSD/galleon/roms/genesis/cavestory.md'
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    viewport: NOVA,
    home: join(HOMES, 'card-missing'),
    files: {
      'config/downloaded_roms.json': JSON.stringify({
        roms: [
          {
            romId: 1,
            path,
            launchPath: path,
            name: 'Cave Story MD',
            coverPath: null,
            files: ['cavestory.md'],
            system: 'genesis',
            platformName: 'Sega Mega Drive',
            sizeBytes: 4096,
            installedAt: '2026-10-01T00:00:00.000Z',
            isDirectory: false,
            emulatorId: SHARED_LIBRARY
          }
        ]
      })
    }
  })
  try {
    await attempt('game-card-missing', async () => {
      await atHome(app)
      await app.goTo('library')
      await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the library to fill')
      await app.choose('[data-rom="1"]')
      await app.waitFor(
        `document.querySelector('[data-action="card-not-inserted"]')`,
        'the card-not-inserted button'
      )
      await shoot(app, 'game-card-missing')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
  }
}

/**
 * Changing the library folder (M1-10): the confirmation, with what would move
 * and its size, asked before anything does. The library starts in a folder of
 * its own so the root's own folder is the one on offer.
 */
async function libraryMove(): Promise<void> {
  const server = await startFakeRomm()
  const old = join(HOMES, 'library-move-old')
  rmSync(old, { recursive: true, force: true })
  const games = [
    { romId: 1, name: 'Cave Story MD', file: 'cavestory.md', sizeBytes: 4 * 1024 ** 2 },
    { romId: 2, name: 'Tanglewood', file: 'tanglewood.md', sizeBytes: 3 * 1024 ** 2 }
  ]
  mkdirSync(join(old, 'genesis'), { recursive: true })
  for (const one of games)
    writeFileSync(join(old, 'genesis', one.file), Buffer.alloc(one.sizeBytes))
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    viewport: NOVA,
    home: join(HOMES, 'library-move'),
    settings: { libraryRoot: old },
    files: {
      'config/downloaded_roms.json': JSON.stringify({
        roms: games.map((one) => ({
          romId: one.romId,
          path: join(old, 'genesis', one.file),
          launchPath: join(old, 'genesis', one.file),
          name: one.name,
          coverPath: null,
          files: [one.file],
          system: 'genesis',
          platformName: 'Sega Mega Drive',
          sizeBytes: one.sizeBytes,
          installedAt: '2026-10-01T00:00:00.000Z',
          isDirectory: false,
          emulatorId: SHARED_LIBRARY
        }))
      })
    }
  })
  try {
    await attempt('settings-library-move', async () => {
      await atHome(app)
      await app.goTo('settings')
      await app.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
      await app.choose('[data-tab="games"]')
      await app.choose('[data-folder=""] [data-action="library-move-here"]')
      await app.waitFor(`document.querySelector('[data-games] [data-rom="1"]')`, 'the plan')
      await shoot(app, 'settings-library-move')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
    rmSync(old, { recursive: true, force: true })
  }
}

/**
 * Stock RomMix's games from before Galleon, offered on the Games tab and then
 * the move's confirmation. Run without `GALLEON_HOME`, under which they are
 * never offered: the user home is a scratch folder with Galleon's root named
 * by its pointer and stock RomMix in `~/rommix` beside it.
 */
async function stockLibrary(): Promise<void> {
  const server = await startFakeRomm()
  const user = join(HOMES, 'stock-user')
  const stock = join(user, 'rommix')
  rmSync(user, { recursive: true, force: true })
  const home = join(HOMES, 'stock')
  mkdirSync(join(user, '.config', 'galleon'), { recursive: true })
  writeFileSync(join(user, '.config', 'galleon', 'root'), home)
  const games = [
    { romId: 1, name: 'Cave Story MD', file: 'cavestory.md', sizeBytes: 4 * 1024 ** 2 },
    { romId: 2, name: 'Tanglewood', file: 'tanglewood.md', sizeBytes: 3 * 1024 ** 2 }
  ]
  mkdirSync(join(stock, 'roms', 'genesis'), { recursive: true })
  mkdirSync(join(stock, 'config'), { recursive: true })
  for (const one of games)
    writeFileSync(join(stock, 'roms', 'genesis', one.file), Buffer.alloc(one.sizeBytes))
  writeFileSync(
    join(stock, 'config', 'settings.json'),
    JSON.stringify({ server: { baseUrl: server.baseUrl } })
  )
  writeFileSync(
    join(stock, 'config', 'downloaded_roms.json'),
    JSON.stringify({
      roms: games.map((one) => ({
        romId: one.romId,
        path: join(stock, 'roms', 'genesis', one.file),
        launchPath: join(stock, 'roms', 'genesis', one.file),
        name: one.name,
        coverPath: null,
        files: [one.file],
        system: 'genesis',
        platformName: 'Sega Mega Drive',
        sizeBytes: one.sizeBytes,
        installedAt: '2026-09-01T00:00:00.000Z',
        isDirectory: false,
        emulatorId: SHARED_LIBRARY
      }))
    })
  )
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    viewport: NOVA,
    home,
    env: { GALLEON_HOME: '', HOME: user, XDG_CONFIG_HOME: join(user, '.config') }
  })
  try {
    await attempt('settings-stock', async () => {
      await atHome(app)
      await app.goTo('settings')
      await app.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
      await app.choose('[data-tab="games"]')
      await app.reach('[data-action="stock-adopt"]')
      await shoot(app, 'settings-stock')
    })
    await attempt('settings-stock-move', async () => {
      await app.choose('[data-action="stock-move"]')
      await app.waitFor(`document.querySelector('[data-games] [data-rom="2"]')`, 'the plan')
      await shoot(app, 'settings-stock-move')
    })
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
    rmSync(user, { recursive: true, force: true })
  }
}

/** A Steam game handed to Steam (M1-14): the overlay that stands in for it. */
async function steamRunning(): Promise<void> {
  const user = mkdtempSync(join(tmpdir(), 'galleon-shots-steam-'))
  const steamapps = join(user, '.local', 'share', 'Steam', 'steamapps')
  mkdirSync(steamapps, { recursive: true })
  writeFileSync(
    join(steamapps, 'appmanifest_1145360.acf'),
    '"AppState" { "appid" "1145360" "name" "Hades" "StateFlags" "4" }'
  )
  const scenario = await startScenario({
    viewport: NOVA,
    home: join(HOMES, 'steam'),
    env: { HOME: user }
  })
  const { app } = scenario
  try {
    await attempt('running-steam', async () => {
      await app.read(`window.rommix.steam.launch('1145360'), true`)
      await app.waitFor(`document.querySelector('[data-action="back-from-steam"]')`, 'the overlay')
      await shoot(app, 'running-steam')
    })
  } finally {
    await scenario.stop()
    rmSync(user, { recursive: true, force: true })
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
await signedIn()
if (wanted('library-iconless')) await iconless()
if (wanted('game-saves-states')) await localStates()
if (wanted('game-conflict')) await conflict()
if (wanted('game-card-missing')) await cardMissing()
if (wanted('settings-library-move')) await libraryMove()
if (wanted('settings-stock')) await stockLibrary()
if (wanted('running-steam')) await steamRunning()
await setup()
contactSheet()

const failures = taken.filter((one) => one.failed)
console.log(`shots:nova: ${taken.length - failures.length} screens in ${OUT}`)
if (failures.length > 0) {
  console.error(
    `shots:nova: ${failures.length} failed: ${failures.map((one) => one.name).join(', ')}`
  )
  process.exit(1)
}
