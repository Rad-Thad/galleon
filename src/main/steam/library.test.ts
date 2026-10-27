import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { installedSteamGames, isInstalled, libraryPaths, readManifest } from './library.ts'
import { parseVdf } from './vdf.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/steam/${name}`, import.meta.url), 'utf8')

const HOME = '/home/deck'
const STEAM = '/home/deck/.local/share/Steam'
const CARD = '/run/media/deck/NovaSD'

/** A Nova's Steam files as a map of path to contents; folders are inferred. */
function machine(files: Record<string, string>) {
  const reads: string[] = []
  return {
    reads,
    sources: {
      home: HOME,
      readText: async (path: string) => {
        reads.push(path)
        if (!(path in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return files[path]
      },
      listDir: async (path: string) => {
        reads.push(`list ${path}`)
        const prefix = `${path}/`
        const names = Object.keys(files)
          .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
          .map((file) => file.slice(prefix.length))
        if (names.length === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return names
      }
    }
  }
}

/** Steam's own library plus a card, as the fixtures describe them. */
const NOVA = {
  [`${STEAM}/steamapps/libraryfolders.vdf`]: fixture('libraryfolders.vdf'),
  [`${STEAM}/config/libraryfolders.vdf`]: fixture('config-libraryfolders.vdf'),
  [`${STEAM}/steamapps/appmanifest_1145360.acf`]: fixture('appmanifest_1145360.acf'),
  [`${STEAM}/steamapps/appmanifest_1794680.acf`]: fixture('appmanifest_1794680.acf'),
  [`${CARD}/steamapps/appmanifest_413150.acf`]: fixture('appmanifest_413150.acf'),
  [`${CARD}/steamapps/appmanifest_105600.acf`]: fixture('appmanifest_105600.acf'),
  [`${CARD}/steamapps/libraryfolder.vdf`]: '"libraryfolder" { "contentid" "1" }'
}

describe('libraryPaths', () => {
  test('reads the current shape, a block per library', () => {
    assert.deepEqual(libraryPaths(parseVdf(fixture('libraryfolders.vdf'))!), [STEAM, CARD])
  })

  test('reads the older shape, paths as values beside counters', () => {
    assert.deepEqual(libraryPaths(parseVdf(fixture('config-libraryfolders.vdf'))!), [
      CARD,
      '/run/media/deck/OLDCARD'
    ])
  })

  test('a file without the list names nothing', () => {
    assert.deepEqual(libraryPaths({}), [])
    assert.deepEqual(libraryPaths({ libraryfolders: { '0': { label: '' } } }), [])
  })
})

describe('readManifest', () => {
  test('reads appid, name, StateFlags and SizeOnDisk', () => {
    const game = readManifest(parseVdf(fixture('appmanifest_1145360.acf'))!, STEAM)
    assert.deepEqual(game, {
      appid: '1145360',
      name: 'Hades',
      library: STEAM,
      installdir: 'Hades',
      stateFlags: 4,
      sizeOnDisk: 11274289152
    })
  })

  test('a game still downloading is not installed; one awaiting an update is', () => {
    const downloading = readManifest(parseVdf(fixture('appmanifest_1794680.acf'))!, STEAM)!
    const updating = readManifest(parseVdf(fixture('appmanifest_413150.acf'))!, CARD)!
    assert.equal(downloading.stateFlags, 1026)
    assert.equal(isInstalled(downloading), false)
    assert.equal(updating.stateFlags, 6)
    assert.equal(isInstalled(updating), true)
  })

  test('a manifest without an appid of digits or a name is no game', () => {
    assert.equal(readManifest({}, STEAM), null)
    assert.equal(readManifest({ AppState: { appid: '12', name: '' } }, STEAM), null)
    assert.equal(readManifest({ AppState: { appid: '../1', name: 'x' } }, STEAM), null)
    assert.equal(readManifest({ AppState: { name: 'x' } }, STEAM), null)
  })

  test('missing or unreadable numbers read as zero', () => {
    const game = readManifest({ appstate: { appid: '7', name: 'x', StateFlags: 'lots' } }, STEAM)!
    assert.equal(game.stateFlags, 0)
    assert.equal(game.sizeOnDisk, 0)
    assert.equal(game.installdir, '')
  })
})

describe('installedSteamGames', () => {
  test('lists the installed games of every library, the card included, by name', async () => {
    const { sources } = machine(NOVA)
    const games = await installedSteamGames(sources)
    assert.deepEqual(
      games.map((game) => [game.appid, game.name, game.library]),
      [
        ['1145360', 'Hades', STEAM],
        ['413150', 'Stardew Valley: "Collector\'s" \\ Edition', CARD]
      ]
    )
  })

  test('excludes partial installs and malformed manifests', async () => {
    const { sources } = machine(NOVA)
    const ids = (await installedSteamGames(sources)).map((game) => game.appid)
    assert.ok(!ids.includes('1794680'), 'a game still downloading is left out')
    assert.ok(!ids.includes('105600'), 'a manifest cut short is left out')
  })

  test('reads both library lists, and a card that is out costs only its games', async () => {
    const { sources, reads } = machine(NOVA)
    await installedSteamGames(sources)
    assert.ok(reads.includes(`${STEAM}/config/libraryfolders.vdf`))
    // OLDCARD, named only by the older list, is looked for but has nothing
    // mounted, and the scan goes on.
    assert.ok(reads.includes('list /run/media/deck/OLDCARD/steamapps'))
  })

  test("Steam's own folder is a library even when no list names it", async () => {
    const { sources } = machine({
      [`${STEAM}/steamapps/appmanifest_1145360.acf`]: fixture('appmanifest_1145360.acf')
    })
    assert.deepEqual(
      (await installedSteamGames(sources)).map((game) => game.appid),
      ['1145360']
    )
  })

  test('a game in two libraries is listed once, from the first', async () => {
    const { sources } = machine({
      ...NOVA,
      [`${CARD}/steamapps/appmanifest_1145360.acf`]: fixture('appmanifest_1145360.acf')
    })
    const hades = (await installedSteamGames(sources)).filter((game) => game.appid === '1145360')
    assert.deepEqual(
      hades.map((game) => game.library),
      [STEAM]
    )
  })

  test("a malformed library list still leaves the other and Steam's own", async () => {
    const { sources } = machine({
      ...NOVA,
      [`${STEAM}/steamapps/libraryfolders.vdf`]: '"libraryfolders" {'
    })
    const ids = (await installedSteamGames(sources)).map((game) => game.appid)
    assert.deepEqual(ids, ['1145360', '413150'])
  })

  test('a library after a card that is out is still read, and the list is by name', async () => {
    const { sources } = machine({
      ...NOVA,
      [`${STEAM}/steamapps/libraryfolders.vdf`]:
        '"libraryfolders" { "1" { "path" "/run/media/deck/OLDCARD" } "2" { "path" "/run/media/deck/NovaSD" } }',
      [`${CARD}/steamapps/appmanifest_999999.acf`]:
        '"AppState" { "appid" "999999" "name" "Aardvark" "StateFlags" "4" }'
    })
    assert.deepEqual(
      (await installedSteamGames(sources)).map((game) => game.name),
      ['Aardvark', 'Hades', 'Stardew Valley: "Collector\'s" \\ Edition']
    )
  })

  test('no Steam at all is an empty list', async () => {
    const { sources } = machine({})
    assert.deepEqual(await installedSteamGames(sources), [])
  })

  test('only appmanifest files are read as games', async () => {
    const { sources, reads } = machine(NOVA)
    await installedSteamGames(sources)
    assert.ok(!reads.includes(`${CARD}/steamapps/libraryfolder.vdf`))
  })
})
