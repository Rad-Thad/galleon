import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { binaryVdf, type Field, shortcut } from '../fixtures/steam/binaryvdf.ts'
import { coverArt, nonSteamShortcuts, parseBinaryVdf } from './shortcuts.ts'

const HOME = '/home/deck'
const STEAM = '/home/deck/.local/share/Steam'

function files(contents: Record<string, Uint8Array>, folders: Record<string, string[]> = {}) {
  return {
    home: HOME,
    readBytes: async (path: string) => {
      if (!(path in contents)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return contents[path]
    },
    listDir: async (path: string) => {
      if (path in folders) return folders[path]
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
  }
}

describe('parseBinaryVdf', () => {
  test('reads maps, strings, signed int32s and the other fixed fields', () => {
    const parsed = parseBinaryVdf(
      binaryVdf({
        shortcuts: { '0': { appid: -1, name: 'x', colour: Uint8Array.from([1, 2, 3, 4]) } }
      })
    )
    assert.deepEqual(parsed, {
      shortcuts: { '0': { appid: -1, name: 'x', colour: Uint8Array.from([1, 2, 3, 4]) } }
    })
  })

  test('a file cut short anywhere is null, never half read', () => {
    const whole = binaryVdf({ shortcuts: { '0': shortcut(3000000000, 'Game') } })
    for (let length = 0; length < whole.length; length++) {
      assert.equal(parseBinaryVdf(whole.subarray(0, length)), null, `cut at ${length}`)
    }
    assert.notEqual(parseBinaryVdf(whole), null)
  })

  test('an unknown field type is null, since the next field cannot be found', () => {
    assert.equal(parseBinaryVdf(Uint8Array.from([0x09, 0x61, 0x00, 0x08])), null)
  })

  test('nesting past what Steam writes is null rather than a deep recursion', () => {
    let nested: Record<string, Field> = { leaf: 'x' }
    for (let i = 0; i < 40; i++) nested = { m: nested }
    assert.equal(parseBinaryVdf(binaryVdf(nested)), null)
  })

  test('reads a buffer that is a view into a larger one', () => {
    const inner = binaryVdf({ a: 7 })
    const outer = new Uint8Array(inner.length + 3)
    outer.set(inner, 3)
    assert.deepEqual(parseBinaryVdf(outer.subarray(3)), { a: 7 })
  })
})

describe('nonSteamShortcuts', () => {
  test("reads every user's list, appids unsigned, either case of the name key", async () => {
    const machine = files(
      {
        [`${STEAM}/userdata/1001/config/shortcuts.vdf`]: binaryVdf({
          shortcuts: {
            '0': shortcut(3000000000, 'Galleon Device Test'),
            '1': shortcut(12345, 'Owner Game', 'appname')
          }
        }),
        [`${STEAM}/userdata/1002/config/shortcuts.vdf`]: binaryVdf({
          shortcuts: { '0': shortcut(4000000000, 'Second User') }
        })
      },
      { [`${STEAM}/userdata`]: ['1002', '1001', 'anonymous'] }
    )
    assert.deepEqual(await nonSteamShortcuts(machine), {
      shortcuts: [
        { appid: '3000000000', name: 'Galleon Device Test', user: '1001' },
        { appid: '12345', name: 'Owner Game', user: '1001' },
        { appid: '4000000000', name: 'Second User', user: '1002' }
      ],
      unreadable: 0
    })
  })

  test('a user without a list has none; a list cut short is counted, not read as empty', async () => {
    const good = binaryVdf({ shortcuts: { '0': shortcut(1, 'Kept') } })
    const cut = binaryVdf({ shortcuts: { '0': shortcut(2, 'Lost') } })
    const machine = files(
      {
        [`${STEAM}/userdata/1/config/shortcuts.vdf`]: good,
        [`${STEAM}/userdata/2/config/shortcuts.vdf`]: cut.subarray(0, cut.length - 3)
      },
      { [`${STEAM}/userdata`]: ['1', '2', '3'] }
    )
    assert.deepEqual(await nonSteamShortcuts(machine), {
      shortcuts: [{ appid: '1', name: 'Kept', user: '1' }],
      unreadable: 1
    })
  })

  test('a list without a shortcuts map is unreadable; entries missing a field are passed over', async () => {
    const machine = files(
      {
        [`${STEAM}/userdata/1/config/shortcuts.vdf`]: binaryVdf({ other: { '0': 'x' } }),
        [`${STEAM}/userdata/2/config/shortcuts.vdf`]: binaryVdf({
          shortcuts: {
            '0': { AppName: 'No appid' },
            '1': { appid: 5 },
            '2': 'flat',
            '3': shortcut(6, 'Six')
          }
        })
      },
      { [`${STEAM}/userdata`]: ['1', '2'] }
    )
    assert.deepEqual(await nonSteamShortcuts(machine), {
      shortcuts: [{ appid: '6', name: 'Six', user: '2' }],
      unreadable: 1
    })
  })

  test('no Steam at all is no shortcuts, not an error', async () => {
    assert.deepEqual(await nonSteamShortcuts(files({})), { shortcuts: [], unreadable: 0 })
  })
})

describe('coverArt', () => {
  test("finds users' grid covers and both app-cache layouts", async () => {
    const cache = `${STEAM}/appcache/librarycache`
    const machine = files(
      {},
      {
        [`${STEAM}/userdata`]: ['1001', '1002'],
        [`${STEAM}/userdata/1001/config/grid`]: [
          '3000000000p.png',
          '3000000000.png',
          '3000000000_hero.jpg',
          '777p.JPG',
          'notes.txt'
        ],
        [`${STEAM}/userdata/1002/config/grid`]: ['888p.webp'],
        [cache]: [
          '413150_library_600x900.jpg',
          '413150_header.jpg',
          '105600_header.jpg',
          '1145360',
          '1794680',
          '620',
          'assets.vdf'
        ],
        [`${cache}/1145360`]: ['header.jpg', 'library_600x900.jpg'],
        [`${cache}/1794680`]: ['header.jpg', 'a1b2c3'],
        [`${cache}/1794680/a1b2c3`]: ['library_600x900_schinese.jpg'],
        [`${cache}/620`]: ['header.jpg', 'library_hero.jpg']
      }
    )
    assert.deepEqual([...(await coverArt(machine))].sort(), [
      '1145360',
      '1794680',
      '3000000000',
      '413150',
      '777',
      '888'
    ])
  })

  test('nothing to look in is no covers', async () => {
    assert.equal((await coverArt(files({}))).size, 0)
  })
})
