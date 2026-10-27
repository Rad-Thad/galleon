import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { atHome, downloadAnyway, standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * While an emulator owns the screen.
 *
 * The one state RomMix is in where the interface is not the thing in front of
 * the player, and where nearly every input is deliberately thrown away. It
 * needs an emulator that ignores being asked to quit — see `standInEmulator` —
 * because a stand-in that dies on the first signal never holds the screen long
 * enough for any of this to be asked of it.
 *
 * Its own file for a second reason: `games.test.ts` already starts three
 * applications, and a fourth in the same process reliably never brought its
 * debugger up.
 *
 * The real emulators go quiet for ordinary reasons: Eden raises its own
 * confirmation dialog, and one opened off-screen or hung never answers it. A
 * direct emulator then had nothing left to try, and RomMix sat waiting on it
 * for as long as it stayed up.
 */

let server: FakeRomm
let stuck: App
let stubborn: ReturnType<typeof standInEmulator>
/** Its own, so the core socket is this application's and no other run's. */
let runtime: string
/** Lets the second game's download finish; it is held until the game has the screen. */
let release: () => void
/** The windows open before the game started. */
let windowsBefore: number

/** The game whose download finishes while another one is played. */
const MID_GAME_ROM = 2
const MID_GAME_TITLE = 'Tobu Tobu Girl'

/**
 * Whether the toast saying the mid-game download finished is on the page. By
 * its message as well as its title: the one saying it started may still be up
 * when the game is launched.
 */
const MID_GAME_TOAST = `[...document.querySelectorAll('.toast')].some((one) =>
  one.querySelector('.toast__title')?.textContent === ${JSON.stringify(MID_GAME_TITLE)} &&
  one.querySelector('.toast__message')?.textContent === 'Download complete')`

/** How long frame callbacks are counted for, each time. */
const FRAME_WINDOW_MS = 2000
/** Ample time for the pad's read to have moved from frames to its timer. */
const SWITCH_MS = 500

/**
 * Counts every animation-frame callback the page runs from here on.
 *
 * Wrapped at the global rather than counted inside RomMix: each loop asks for
 * its next frame through `window.requestAnimationFrame` again, so every one of
 * them, the overlay's and the pad's alike, is counted without naming it.
 */
const COUNT_FRAMES = `(() => {
  if (window.__frameCallbacks !== undefined) return true
  window.__frameCallbacks = 0
  const ask = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    ask((timestamp) => { window.__frameCallbacks += 1; callback(timestamp) })
  return true
})()`

/** The frame callbacks the page ran over one window. */
async function framesOver(app: App): Promise<number> {
  const first = await app.read<number>('window.__frameCallbacks')
  await new Promise((done) => setTimeout(done, FRAME_WINDOW_MS))
  return (await app.read<number>('window.__frameCallbacks')) - first
}

/** One request over the core socket, and its answer. See `docs/core-socket.md`. */
function ask(cmd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(join(runtime, 'galleon', 'core.sock'))
    let got = ''
    client.on('error', reject)
    client.on('data', (chunk) => {
      got += chunk.toString('utf8')
      if (!got.includes('\n')) return
      client.end()
      resolve(JSON.parse(got.slice(0, got.indexOf('\n'))))
    })
    client.write(`${JSON.stringify({ cmd })}\n`)
  })
}

before(async () => {
  server = await startFakeRomm()
  stubborn = standInEmulator({ stubborn: true })
  runtime = mkdtempSync(join(tmpdir(), 'galleon-runtime-'))
  stuck = await startApp({
    env: { XDG_RUNTIME_DIR: runtime },
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      systemEmulators: { switch: 'eden' },
      emulatorPaths: { eden: stubborn.path },
      confirmSavePush: false,
      // On, so the overlay's own loop is among the ones that must stop.
      perfOverlay: true
    }
  })
})

after(async () => {
  release?.()
  await stuck?.stop()
  await server?.close().catch(() => undefined)
  if (runtime) rmSync(runtime, { recursive: true, force: true })
})

describe('while an emulator owns the screen', () => {
  /** Standard mapping, the two buttons that matter here. */
  const A = 0
  const START = 9

  test('a game takes the screen, and the overlay says so', async () => {
    await atHome(stuck)
    await stuck.goTo('library')
    await stuck.choose('[data-rom="3"]')
    await stuck.choose('[data-action="download"]')
    await stuck.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 3)`,
      'the game to arrive'
    )
    await stuck.read(COUNT_FRAMES)
    await stuck.waitFor(`document.querySelector('[data-perf-overlay]')`, 'the perf overlay')
    assert.ok((await framesOver(stuck)) > 0, 'the interface should draw while it has the screen')

    // A second download, held in flight so that it finishes only once the
    // game has the screen: the moment a launcher most often raises something.
    release = server.holdContent(MID_GAME_ROM)
    await stuck.goTo('library')
    await stuck.choose(`[data-rom="${MID_GAME_ROM}"]`)
    await downloadAnyway(stuck)
    await stuck.goTo('library')
    await stuck.choose('[data-rom="3"]')

    windowsBefore = await stuck.windows()
    assert.equal(windowsBefore, 1, 'the launcher should be the only window')
    await stuck.choose('[data-action="play"]')
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the running overlay')
  })

  test('nothing in the renderer asks for a frame while it does', async () => {
    // The pad is read on a timer and the perf overlay is down, so the window
    // behind the game wakes nothing every refresh. Counted from a moment after
    // the overlay is drawn: the pad's read already waiting on a frame when the
    // game started still runs, and it is that read which puts the next one on
    // the timer.
    await new Promise((done) => setTimeout(done, SWITCH_MS))
    assert.equal(
      await stuck.read<boolean>(`!!document.querySelector('[data-perf-overlay]')`),
      false
    )
    assert.equal(await framesOver(stuck), 0)
  })

  test('a download finishing during play opens no window, and its notice waits', async () => {
    release()
    await stuck.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === ${MID_GAME_ROM})`,
      'the second game to arrive'
    )
    // A moment for anything the finished download raises to have been drawn,
    // so that its absence means held rather than not yet.
    await new Promise((done) => setTimeout(done, SWITCH_MS))
    assert.equal(await stuck.windows(), windowsBefore, 'no window should open while a game runs')
    assert.equal(await stuck.read<boolean>(MID_GAME_TOAST), false, 'its notice should wait')
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the game to still have the screen')
  })

  test('the core socket asks it to quit the way holding Start does, never by force', async () => {
    // What the Decky panel sends. The stand-in ignores being asked, so the
    // game stays up, which is the point: a graceful stop gives the emulator
    // time to write its save, and a panel outside cannot see when it has.
    assert.deepEqual(await ask('quit-emulator'), { ok: true, result: { stopping: true } })
    const said = readFileSync(join(stuck.home, 'logs', 'app.log'), 'utf8')
    assert.match(said, /stopping the running game/)
    assert.doesNotMatch(said, /forcing the running game closed/)
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the overlay to stay up')
  })

  test('the pad belongs to the game, so nothing on it reaches RomMix', async () => {
    // The Gamepad API is polled rather than delivered: `navigator.getGamepads()`
    // reports button state whoever holds window focus, so without suspending it
    // every press meant for the game was read here too. A was the one that hurt
    // — the overlay used to autofocus its close button, so pressing A in a game
    // quit the game.
    const pad = await stuck.plugInPad()

    await pad.tap(A)
    await pad.tap(START)

    // Nothing moved. Asserted rather than waited for, because the claim is that
    // no press arrived: the overlay is still offering to close rather than
    // reporting that it has asked.
    assert.equal(
      await stuck.read<boolean>(
        `Boolean(document.querySelector('[data-action="close-emulator"]'))`
      ),
      true,
      'a tap should not have reached the overlay'
    )
    await pad.unplug()
  })

  test('except Start held down, which is the way back from a hung one', async () => {
    // The one press that gets through, and it has to be held: no game's own use
    // of Start can trip a hold this long, and an emulator that has hung or
    // opened off-screen leaves nothing else to try. The game sees the press
    // either way and will open its own pause menu, which is fine.
    const pad = await stuck.plugInPad()
    await pad.hold(START)
    await new Promise((done) => setTimeout(done, 1_800))
    await pad.release(START)
    await pad.unplug()

    // The same handler the close button reaches. The request is not the
    // outcome: an emulator is given time to save, so the overlay stays up and
    // would otherwise look like a press that did nothing.
    await stuck.waitFor(
      `!document.querySelector('[data-action="close-emulator"]')`,
      'the close offer to be spent'
    )
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the overlay to stay up')
  })

  test('and once it is plainly not going, forcing it is offered', async () => {
    // Only after a wait, because the emulator is entitled to take a moment and
    // a force offered immediately is a force people press by reflex. See
    // `FORCE_AFTER_MS`.
    await stuck.waitFor(
      `document.querySelector('[data-action="force-close"]')`,
      'the offer to force it',
      20_000
    )

    await stuck.choose('[data-action="force-close"]')

    // Gone, which is the only outcome that counts: the overlay is up for
    // exactly as long as something has the screen, so its leaving is the
    // emulator being gone rather than a message about it.
    await stuck.waitFor(`!document.querySelector('.overlay')`, 'the emulator to go', 20_000)
    await stuck.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen back')

    // The notice held while it played is shown now, and still in the window
    // that was always there.
    await stuck.waitFor(MID_GAME_TOAST, 'the held notice to be shown')
    assert.equal(await stuck.windows(), windowsBefore)

    // And the interface's loops are back with it.
    await stuck.waitFor(`document.querySelector('[data-perf-overlay]')`, 'the perf overlay back')
    assert.ok(
      (await framesOver(stuck)) > 0,
      'the interface should draw again once the game is gone'
    )
  })
})
