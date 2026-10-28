import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { binaryVdf, shortcut } from '../fixtures/steam/binaryvdf.ts'
import { type BinaryVdfField, findField, readBinaryVdf, writeBinaryVdf } from './binaryvdf.ts'
import { type GalleonShortcut, shortcutAppid, steamRunning, upsertShortcut } from './addshortcut.ts'
import { parseBinaryVdf } from './shortcuts.ts'

const GALLEON: GalleonShortcut = {
  name: 'Galleon',
  exe: '"/home/deck/Applications/galleon-steam.sh"',
  startDir: '"/home/deck/Applications/"',
  launchOptions: '/usr/libexec/armada/armada-game-launch %command%',
  icon: '/home/deck/Applications/galleon.png'
}

type Entries = Extract<BinaryVdfField, { type: 'map' }>[]

function entries(fields: BinaryVdfField[]): Entries {
  return (findField(fields, 'shortcuts') as { fields: Entries }).fields
}

/** Each entry's bytes on its own, to show which ones a change touched. */
function entryBytes(fields: BinaryVdfField[]): Uint8Array[] {
  return entries(fields).map((entry) => writeBinaryVdf([entry]))
}

function ownersList(): Uint8Array {
  return binaryVdf({
    shortcuts: {
      '0': shortcut(3000000000, 'RetroArch'),
      '1': { ...shortcut(2500000000, 'Odd', 'appname'), colour: Uint8Array.from([1, 2, 3, 4]) }
    }
  })
}

describe('upsertShortcut', () => {
  test('adds Galleon after the owner’s entries and leaves theirs byte for byte', () => {
    const before = readBinaryVdf(ownersList())!
    const theirs = entryBytes(before)
    const result = upsertShortcut(readBinaryVdf(ownersList())!, GALLEON)
    assert.equal(result?.change, 'added')
    const after = readBinaryVdf(writeBinaryVdf(result!.fields))!
    assert.deepEqual(entryBytes(after).slice(0, 2), theirs)

    const listed = parseBinaryVdf(writeBinaryVdf(after)) as {
      shortcuts: Record<string, Record<string, unknown>>
    }
    const added = listed.shortcuts['2']
    assert.equal(added.AppName, 'Galleon')
    assert.equal(added.Exe, GALLEON.exe)
    assert.equal(added.StartDir, GALLEON.startDir)
    assert.equal(added.LaunchOptions, GALLEON.launchOptions)
    assert.equal((added.appid as number) >>> 0, shortcutAppid(GALLEON.exe, GALLEON.name))
  })

  test('an entry for the same exe is updated, not duplicated, and keeps its appid and play time', () => {
    const first = upsertShortcut(readBinaryVdf(ownersList())!, GALLEON)!.fields
    const appid = (findField(entries(first)[2].fields, 'appid') as { value: number }).value >>> 0
    const played = findField(entries(first)[2].fields, 'LastPlayTime') as { value: number }
    played.value = 1761600000
    const theirs = entryBytes(first).slice(0, 2)

    const moved = { ...GALLEON, name: 'Galleon Nightly', launchOptions: '%command%' }
    const result = upsertShortcut(readBinaryVdf(writeBinaryVdf(first))!, moved)!
    assert.equal(result.change, 'updated')
    const list = entries(result.fields)
    assert.equal(list.length, 3)
    assert.deepEqual(entryBytes(result.fields).slice(0, 2), theirs)
    const galleon = list[2].fields
    assert.equal((findField(galleon, 'appid') as { value: number }).value >>> 0, appid)
    assert.deepEqual(findField(galleon, 'AppName'), {
      type: 'string',
      name: 'AppName',
      value: 'Galleon Nightly'
    })
    assert.equal((findField(galleon, 'LaunchOptions') as { value: string }).value, '%command%')
    assert.equal((findField(galleon, 'LastPlayTime') as { value: number }).value, 1761600000)
  })

  test('an entry Steam wrote with lower-case keys and fields Galleon does not know is updated in place', () => {
    const bytes = binaryVdf({
      shortcuts: {
        '0': { appid: 5, appname: 'Old', exe: GALLEON.exe, startdir: '"/"', extra: 'kept' }
      }
    })
    const result = upsertShortcut(readBinaryVdf(bytes)!, GALLEON)!
    assert.equal(result.change, 'updated')
    const fields = entries(result.fields)[0].fields
    assert.deepEqual(
      fields.map((field) => field.name),
      ['appid', 'appname', 'exe', 'startdir', 'extra', 'icon', 'LaunchOptions']
    )
    assert.equal((findField(fields, 'appname') as { value: string }).value, 'Galleon')
    assert.equal((findField(fields, 'extra') as { value: string }).value, 'kept')
  })

  test('the new entry takes the index after the highest, and an empty list starts at 0', () => {
    const gappy = binaryVdf({ shortcuts: { '0': shortcut(1, 'A'), '7': shortcut(2, 'B') } })
    assert.equal(entries(upsertShortcut(readBinaryVdf(gappy)!, GALLEON)!.fields)[2].name, '8')
    const empty = binaryVdf({ shortcuts: {} })
    assert.equal(entries(upsertShortcut(readBinaryVdf(empty)!, GALLEON)!.fields)[0].name, '0')
  })

  test('a file without a shortcuts map is not a list to change', () => {
    assert.equal(upsertShortcut(readBinaryVdf(binaryVdf({ other: {} }))!, GALLEON), null)
    assert.equal(upsertShortcut(readBinaryVdf(binaryVdf({ shortcuts: 'x' }))!, GALLEON), null)
  })

  test('the appid is Steam’s: the top bit set over a CRC of exe and name', () => {
    const appid = shortcutAppid(GALLEON.exe, GALLEON.name)
    assert.ok(appid >= 0x80000000 && appid <= 0xffffffff)
    assert.notEqual(appid, shortcutAppid(GALLEON.exe, 'Other'))
    assert.equal(
      shortcutAppid('"/usr/bin/true"', 'True'),
      (0x80000000 | crcOf('"/usr/bin/true"True')) >>> 0
    )
  })
})

/** CRC-32 by the book, independent of node:zlib. */
function crcOf(text: string): number {
  let crc = ~0
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return ~crc >>> 0
}

describe('steamRunning', () => {
  function proc(processes: Record<string, string>, pidFile?: string) {
    return {
      home: '/home/deck',
      readText: async (path: string) => {
        if (path === '/home/deck/.steam/steam.pid' && pidFile !== undefined) return pidFile
        const match = /^\/proc\/(\d+)\/comm$/.exec(path)
        if (match && match[1] in processes) return `${processes[match[1]]}\n`
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      listDir: async (path: string) => {
        if (path === '/proc') return [...Object.keys(processes), 'self', 'sys']
        throw new Error('ENOENT')
      }
    }
  }

  test('a process named steam is Steam running', async () => {
    assert.equal(await steamRunning(proc({ '1': 'systemd', '4242': 'steam' })), true)
  })

  test('the pid file counts while its process lives, whatever that process is called', async () => {
    assert.equal(await steamRunning(proc({ '1': 'systemd', '900': 'reaper' }, '900\n')), true)
  })

  test('a /proc that cannot be listed counts as running, so nothing is written', async () => {
    const sources = { ...proc({}), listDir: async () => Promise.reject(new Error('EACCES')) }
    assert.equal(await steamRunning(sources), true)
  })

  test('a pid file left by a crash, and no steam process, is not running', async () => {
    assert.equal(await steamRunning(proc({ '1': 'systemd' }, '900\n')), false)
    assert.equal(await steamRunning(proc({ '1': 'systemd' })), false)
    assert.equal(await steamRunning(proc({ '1': 'steamwebhelper' }, 'garbage')), false)
  })
})
