import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atHome, standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * A conflict, settled by the player and by nothing else (M2-16).
 *
 * Two saves of one game that RomM holds newer copies of from another device,
 * so the push that tries to send them is turned away with a 409 on each: one
 * in the shared slot this device has never taken a copy of, one under its own
 * name that this device took an older copy of. Each answer is then checked by
 * what reached the server, which is the whole of what it means.
 *
 * Its own application, with RetroArch for a Genesis game as the saves suite in
 * `games.test.ts` has it, and `XDG_CONFIG_HOME` pinned so the save folder is a
 * folder this test knows.
 */
describe('a conflict is the player’s to settle', () => {
  /** This device's id on RomM, as `startApp` seeds it. */
  const thisDevice = 'integration-test'
  let server: FakeRomm
  let app: App
  let saveDir: string
  /** RomM's ids for the two copies the player is asked about. */
  let slotted: number
  let named: number

  before(async () => {
    server = await startFakeRomm({
      devices: [
        {
          id: 'some-other-device',
          name: 'Argosy @ phone',
          hostname: null,
          client_device_identifier: 'argosy-phone'
        }
      ]
    })
    server.holdSave({
      romId: 1,
      fileName: 'Cave Story (E).srm',
      slot: 'autosave',
      emulator: 'genesis_plus_gx',
      content: 'their autosave'
    })
    server.holdSave({
      romId: 1,
      fileName: 'cavestory.sav',
      emulator: 'genesis_plus_gx',
      content: 'their sav',
      staleFor: thisDevice
    })
    const listed = (await (
      await fetch(`${server.baseUrl}/api/saves?rom_id=1`, {
        headers: { authorization: `Bearer ${server.token}` }
      })
    ).json()) as { id: number; file_name: string }[]
    slotted = listed.find((one) => one.file_name === 'Cave Story (E).srm')!.id
    named = listed.find((one) => one.file_name === 'cavestory.sav')!.id

    const configHome = mkdtempSync(join(tmpdir(), 'rommix-xdg-'))
    saveDir = join(configHome, 'retroarch', 'saves')
    app = await startApp({
      baseUrl: server.baseUrl,
      token: server.token,
      settings: {
        systemEmulators: { genesis: 'retroarch' },
        emulatorPaths: { retroarch: standInEmulator().path },
        confirmSavePush: false
      },
      env: { XDG_CONFIG_HOME: configHome }
    })
  })

  after(async () => {
    await app?.stop()
    await server?.close()
  })

  /** Uploads that asked RomM to replace what another device left. */
  const overwrites = (): FakeRomm['uploaded'] => server.uploaded.filter((one) => one.overwrite)

  test('a push RomM turns away becomes the question, both copies side by side', async () => {
    await atHome(app)
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
      'the game to arrive'
    )

    // Played here since, and neither is a continuation of anything this device
    // took from RomM. `cavestory.srm` is the one that goes in the shared slot
    // (`primarySave`), and the newer of the two, so it is asked about first.
    mkdirSync(saveDir, { recursive: true })
    writeFileSync(join(saveDir, 'cavestory.srm'), 'my autosave')
    writeFileSync(join(saveDir, 'cavestory.sav'), 'my sav')
    const now = Date.now() / 1000
    utimesSync(join(saveDir, 'cavestory.sav'), now - 10, now - 10)

    await app.choose('[data-action="push-saves"]')
    await app.waitFor(`document.querySelector('.overlay [data-conflict]')`, 'the conflict dialog')

    assert.equal(
      server.asked.filter((one) => one.method === 'POST' && one.path.startsWith('/api/saves?'))
        .length,
      2,
      'both saves should have been offered to RomM'
    )
    assert.equal(server.uploaded.length, 0, `RomM took ${JSON.stringify(server.uploaded)}`)

    const dialog = await app.read<{
      file: string
      device: string
      romm: string
      title: string
    }>(
      `(() => {
         const overlay = document.querySelector('.overlay')
         return {
           file: overlay.querySelector('[data-conflict]').dataset.conflict,
           device: overlay.querySelector('[data-side="device"]').textContent,
           romm: overlay.querySelector('[data-side="romm"]').textContent,
           title: overlay.textContent
         }
       })()`
    )
    assert.equal(dialog.file, join(saveDir, 'cavestory.srm'))
    // RomM's column names the device the copy came from, by RomM's own name for it.
    assert.match(dialog.romm, /Argosy @ phone/)
    assert.match(dialog.romm, /14 B/)
    assert.match(dialog.device, /11 B/)
    assert.match(dialog.title, /1 of 2/)

    // Opened on the answer that moves nothing.
    assert.equal(
      await app.read<boolean>(
        `document.querySelector('[data-action="conflict-skip"]').matches('[data-focused="true"]')`
      ),
      true
    )
  })

  test('moving the highlight over the answers settles nothing', async () => {
    const askedSoFar = server.asked.length
    await app.reach('[data-action="conflict-keep-device"]')
    await app.reach('[data-action="conflict-keep-romm"]')
    await new Promise((done) => setTimeout(done, 500))
    const since = server.asked.slice(askedSoFar)
    assert.equal(
      since.some((one) => one.method === 'POST' || one.path.includes('/content')),
      false,
      `moving focus reached RomM: ${JSON.stringify(since.map((one) => one.path))}`
    )
  })

  test("keeping RomM's brings that copy down, and the highlight stays on that answer", async () => {
    // RomM slow to list saves: the next question is on screen while the Saves
    // tab is still being refreshed behind it, which is when the player answers
    // it on a slow machine. The next scenario presses in that window.
    server.slowSaveListings(2000)
    await app.choose('[data-action="conflict-keep-romm"]')
    await app.waitFor(
      `document.querySelector('.overlay [data-conflict]')?.dataset.conflict.endsWith('cavestory.sav')`,
      'the second conflict'
    )

    assert.equal(readFileSync(join(saveDir, 'cavestory.srm'), 'utf8'), 'their autosave')
    assert.ok(
      server.asked.some((one) => one.path.startsWith(`/api/saves/${slotted}/content`)),
      "RomM's copy should have been fetched by its id"
    )
    assert.ok(
      server.asked.some(
        (one) => one.method === 'POST' && one.path === `/api/saves/${slotted}/downloaded`
      ),
      'RomM should have been told this device now holds it'
    )
    assert.equal(server.uploaded.length, 0, "keeping RomM's should send nothing")

    // The dangerous-neighbour rule: the list moved under the highlight, and the
    // highlight is still on the answer just given rather than on a neighbour.
    assert.equal(
      await app.read<boolean>(
        `document.querySelector('[data-action="conflict-keep-romm"]').matches('[data-focused="true"]')`
      ),
      true,
      `the highlight moved to "${await app.focused()}"`
    )
    assert.match(await app.read<string>(`document.querySelector('.overlay').textContent`), /2 of 2/)
  })

  test("keeping this device's sends that one file with overwrite, and only it", async () => {
    try {
      await app.choose('[data-action="conflict-keep-device"]')
      await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')
    } finally {
      server.slowSaveListings(0)
    }

    const sent = overwrites()
    assert.equal(sent.length, 1, `overwrites: ${JSON.stringify(sent)}`)
    assert.equal(sent[0].slot, null)
    assert.equal(sent[0].deviceId, thisDevice)
    assert.match(sent[0].body, /filename="cavestory\.sav"/)
    assert.match(sent[0].body, /my sav/)
    // Nothing of RomM's came down for it.
    assert.equal(
      server.asked.some((one) => one.path.startsWith(`/api/saves/${named}/content`)),
      false
    )
    assert.equal(readFileSync(join(saveDir, 'cavestory.sav'), 'utf8'), 'my sav')
  })

  test('skipping moves nothing in either direction', async () => {
    // Another device moves the shared slot on again, and this one plays on.
    server.holdSave({
      romId: 1,
      fileName: 'Cave Story (E).srm',
      slot: 'autosave',
      emulator: 'genesis_plus_gx',
      content: 'their next autosave'
    })
    writeFileSync(join(saveDir, 'cavestory.srm'), 'my next autosave')

    await app.choose('[data-action="push-saves"]')
    await app.waitFor(`document.querySelector('.overlay [data-conflict]')`, 'the conflict dialog')
    const askedSoFar = server.asked.length
    const uploads = server.uploaded.length
    await app.choose('[data-action="conflict-skip"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')

    await new Promise((done) => setTimeout(done, 500))
    const since = server.asked.slice(askedSoFar)
    assert.equal(
      since.some(
        (one) =>
          (one.method === 'POST' && one.path.startsWith('/api/saves')) ||
          one.path.includes('/content')
      ),
      false,
      `a skip reached RomM: ${JSON.stringify(since.map((one) => one.path))}`
    )
    assert.equal(server.uploaded.length, uploads)
    assert.equal(readFileSync(join(saveDir, 'cavestory.srm'), 'utf8'), 'my next autosave')
    assert.equal(overwrites().length, 1, 'only the one chosen overwrite, ever')
  })
})
