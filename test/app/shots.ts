import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startApp, type App } from './driver.ts'
import { startScenario } from './harness.ts'
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

    for (const screen of ['downloads', 'bios', 'emulators'])
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

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
await signedIn()
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
