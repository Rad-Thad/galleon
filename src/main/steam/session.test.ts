import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RunningState } from '@shared/api'
import { isSteamTool } from './library.ts'
import { listSteamGames, SteamSession } from './session.ts'

const STEAMAPPS = '/home/deck/.local/share/Steam/steamapps'

function manifest(appid: string, name: string, flags = '4', size = '100'): string {
  return `"AppState" { "appid" "${appid}" "name" "${name}" "StateFlags" "${flags}" "SizeOnDisk" "${size}" "installdir" "x" }`
}

describe('isSteamTool', () => {
  test("Steam's runtimes, Proton builds and redistributables are tools", () => {
    for (const [appid, name] of [
      ['228980', 'Steamworks Common Redistributables'],
      ['1628350', 'Steam Linux Runtime 3.0 (sniper)'],
      ['1070560', 'Steam Linux Runtime 1.0 (scout)'],
      ['1493710', 'Proton Experimental'],
      ['2805730', 'Proton 9.0'],
      ['1826330', 'Proton EasyAntiCheat Runtime'],
      ['228980', 'renamed']
    ]) {
      assert.equal(isSteamTool({ appid, name }), true, name)
    }
  })

  test('games are not, even with a tool word inside the name', () => {
    for (const [appid, name] of [
      ['1145360', 'Hades'],
      ['999', 'Protonic Resistance'],
      ['998', 'The Proton Game'],
      ['997', 'Steamworks Common Redistributables Simulator']
    ]) {
      assert.equal(isSteamTool({ appid, name }), false, name)
    }
  })
})

describe('listSteamGames', () => {
  test('installed games only, tools left out, with what the library shows', async () => {
    const files: Record<string, string> = {
      [`${STEAMAPPS}/appmanifest_1145360.acf`]: manifest('1145360', 'Hades', '4', '15000'),
      [`${STEAMAPPS}/appmanifest_1493710.acf`]: manifest('1493710', 'Proton Experimental'),
      [`${STEAMAPPS}/appmanifest_228980.acf`]: manifest(
        '228980',
        'Steamworks Common Redistributables'
      ),
      [`${STEAMAPPS}/appmanifest_413150.acf`]: manifest('413150', 'Stardew Valley', '1026')
    }
    const games = await listSteamGames({
      home: '/home/deck',
      readText: async (path) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]
      },
      listDir: async (path) => {
        if (path !== STEAMAPPS) throw new Error('ENOENT')
        return Object.keys(files).map((file) => file.slice(STEAMAPPS.length + 1))
      }
    })
    assert.deepEqual(games, [{ appid: '1145360', name: 'Hades', sizeOnDisk: 15000 }])
  })
})

describe('SteamSession', () => {
  const HADES = { appid: '1145360', name: 'Hades', sizeOnDisk: 1 }

  function session(launched: string[] | null = ['/usr/bin/steam', 'steam://rungameid/1145360']) {
    const sent: RunningState[] = []
    const asked: string[] = []
    const steam = new SteamSession(
      (state) => sent.push(state),
      (appid) => {
        asked.push(appid)
        // The overlay is already up when Steam is asked.
        assert.equal(sent.at(-1)?.running, true)
        return launched
      }
    )
    return { steam, sent, asked }
  }

  test('raises the overlay naming the game, then asks Steam', () => {
    const { steam, sent, asked } = session()
    assert.equal(steam.start(HADES), true)
    assert.deepEqual(asked, ['1145360'])
    assert.deepEqual(sent, [
      { running: true, romId: null, emulator: null, steam: 'Hades', stage: null }
    ])
    assert.deepEqual(steam.playing, HADES)
  })

  test('ending lowers the overlay once', () => {
    const { steam, sent } = session()
    steam.start(HADES)
    assert.equal(steam.end(), true)
    assert.equal(steam.end(), false)
    assert.equal(steam.playing, null)
    assert.deepEqual(sent.at(-1), {
      running: false,
      romId: null,
      emulator: null,
      steam: null,
      stage: null
    })
    assert.equal(sent.length, 2)
  })

  test('an appid Steam was not asked to run lowers what it raised', () => {
    const { steam, sent } = session(null)
    assert.equal(steam.start(HADES), false)
    assert.equal(steam.playing, null)
    assert.deepEqual(
      sent.map((state) => state.running),
      [true, false]
    )
  })

  test('nothing to end before a start', () => {
    const { steam, sent } = session()
    assert.equal(steam.end(), false)
    assert.deepEqual(sent, [])
  })
})
