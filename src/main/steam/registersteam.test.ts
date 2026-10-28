import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { binaryVdf, shortcut } from '../fixtures/steam/binaryvdf.ts'
import { type GalleonShortcut, shortcutAppid } from './addshortcut.ts'
import { type BinaryVdfField, findField, readBinaryVdf, writeBinaryVdf } from './binaryvdf.ts'
import { addToSteam } from './registersteam.ts'

const GALLEON: GalleonShortcut = {
  name: 'Galleon',
  exe: '"/home/deck/Applications/galleon-steam.sh"',
  startDir: '"/home/deck/Applications/"',
  launchOptions: '/usr/libexec/armada/armada-game-launch %command%',
  icon: '/home/deck/Applications/galleon.png'
}
const APPID = shortcutAppid(GALLEON.exe, GALLEON.name)
const COVER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])

let home: string
const notRunning = async () => false
const at = (iso: string) => () => new Date(iso)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'galleon-registersteam-test-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function config(user: string): string {
  return join(home, '.local', 'share', 'Steam', 'userdata', user, 'config')
}

function putList(user: string, bytes: Uint8Array): void {
  mkdirSync(config(user), { recursive: true })
  writeFileSync(join(config(user), 'shortcuts.vdf'), bytes)
}

function list(user: string): Uint8Array {
  return readFileSync(join(config(user), 'shortcuts.vdf'))
}

function names(user: string): string[] {
  const fields = readBinaryVdf(list(user))!
  const entries = findField(fields, 'shortcuts') as { fields: { fields: BinaryVdfField[] }[] }
  return entries.fields.map((entry) => {
    const name = findField(entry.fields, 'AppName')
    return name?.type === 'string' ? name.value : ''
  })
}

const OWNERS = () =>
  binaryVdf({ shortcuts: { '0': shortcut(3000000000, 'RetroArch'), '1': shortcut(5, 'Odd') } })

describe('addToSteam', () => {
  test('while Steam runs nothing is written, not even a folder', async () => {
    putList('100', OWNERS())
    const result = await addToSteam(GALLEON, {
      home,
      running: async () => true,
      art: { 'p.png': COVER }
    })
    assert.deepEqual(result, { outcome: 'steam-running' })
    assert.deepEqual(Buffer.from(list('100')), Buffer.from(OWNERS()))
    assert.deepEqual(readdirSync(config('100')), ['shortcuts.vdf'])
  })

  test('no Steam user folder is said, and nothing is made', async () => {
    assert.deepEqual(await addToSteam(GALLEON, { home, running: notRunning }), {
      outcome: 'no-steam-user'
    })
    assert.deepEqual(readdirSync(home), [])
  })

  test('every user gets the entry; a list is backed up byte for byte before it is replaced', async () => {
    putList('100', OWNERS())
    mkdirSync(config('200'), { recursive: true })
    const result = await addToSteam(GALLEON, {
      home,
      running: notRunning,
      now: at('2026-10-28T22:40:01.234Z')
    })
    const backup = 'shortcuts.vdf.galleon-backup-20261028T224001234Z'
    assert.deepEqual(result, {
      outcome: 'done',
      users: [
        { user: '100', change: 'added', backup },
        { user: '200', change: 'added' }
      ]
    })
    assert.deepEqual(readFileSync(join(config('100'), backup)), Buffer.from(OWNERS()))
    assert.deepEqual(names('100'), ['RetroArch', 'Odd', 'Galleon'])
    assert.deepEqual(names('200'), ['Galleon'])
    assert.deepEqual(readdirSync(config('100')).sort(), [backup, 'shortcuts.vdf'].sort())
  })

  test('a second run updates the one entry, keeps the first backup and adds its own', async () => {
    putList('100', OWNERS())
    await addToSteam(GALLEON, { home, running: notRunning, now: at('2026-10-28T22:40:00.000Z') })
    const moved = { ...GALLEON, launchOptions: '%command%' }
    const result = await addToSteam(moved, {
      home,
      running: notRunning,
      now: at('2026-10-28T22:41:00.000Z')
    })
    assert.equal(result.outcome === 'done' && result.users[0].change, 'updated')
    assert.deepEqual(names('100'), ['RetroArch', 'Odd', 'Galleon'])
    assert.deepEqual(
      readdirSync(config('100'))
        .filter((name) => name.includes('backup'))
        .sort(),
      [
        'shortcuts.vdf.galleon-backup-20261028T224000000Z',
        'shortcuts.vdf.galleon-backup-20261028T224100000Z'
      ]
    )
    assert.deepEqual(
      readFileSync(join(config('100'), 'shortcuts.vdf.galleon-backup-20261028T224000000Z')),
      Buffer.from(OWNERS())
    )
  })

  test('a run that would change nothing writes nothing and makes no backup', async () => {
    putList('100', OWNERS())
    await addToSteam(GALLEON, { home, running: notRunning, now: at('2026-10-28T22:40:00.000Z') })
    const written = list('100')
    const result = await addToSteam(GALLEON, {
      home,
      running: notRunning,
      now: at('2026-10-28T22:41:00.000Z')
    })
    assert.deepEqual(result, { outcome: 'done', users: [{ user: '100', change: 'unchanged' }] })
    assert.deepEqual(list('100'), written)
    assert.equal(readdirSync(config('100')).filter((name) => name.includes('backup')).length, 1)
  })

  test('a list that cannot be read exactly is left alone, and the other users still get theirs', async () => {
    const odd = Uint8Array.from([...OWNERS(), 0x00])
    putList('100', odd)
    putList('101', binaryVdf({ other: {} }))
    putList('200', OWNERS())
    const result = await addToSteam(GALLEON, { home, running: notRunning })
    assert.deepEqual(
      result.outcome === 'done' && result.users.map((user) => [user.user, user.change]),
      [
        ['100', 'unreadable'],
        ['101', 'unreadable'],
        ['200', 'added']
      ]
    )
    assert.deepEqual(Buffer.from(list('100')), Buffer.from(odd))
    assert.deepEqual(readdirSync(config('100')), ['shortcuts.vdf'])
    assert.deepEqual(readdirSync(config('101')), ['shortcuts.vdf'])
  })

  test('only Steam account folders are users', async () => {
    putList('100', OWNERS())
    mkdirSync(join(home, '.local', 'share', 'Steam', 'userdata', 'anonymous', 'config'), {
      recursive: true
    })
    const result = await addToSteam(GALLEON, { home, running: notRunning })
    assert.deepEqual(result.outcome === 'done' && result.users.map((user) => user.user), ['100'])
  })

  test('art goes under the entry’s appid, and art already there is kept', async () => {
    putList('100', OWNERS())
    const existing = binaryVdf({
      shortcuts: { '0': { appid: 1234, AppName: 'Old', Exe: GALLEON.exe } }
    })
    putList('200', existing)
    mkdirSync(join(config('100'), 'grid'))
    writeFileSync(join(config('100'), 'grid', `${APPID}p.png`), 'mine')

    const art = { 'p.png': COVER, '_hero.png': Uint8Array.from([1]) }
    await addToSteam(GALLEON, { home, running: notRunning, art })
    assert.equal(readFileSync(join(config('100'), 'grid', `${APPID}p.png`), 'utf8'), 'mine')
    assert.deepEqual(
      readFileSync(join(config('100'), 'grid', `${APPID}_hero.png`)),
      Buffer.from([1])
    )
    assert.deepEqual(readdirSync(join(config('200'), 'grid')).sort(), [
      '1234_hero.png',
      '1234p.png'
    ])
    assert.deepEqual(readFileSync(join(config('200'), 'grid', '1234p.png')), Buffer.from(COVER))
  })

  test('the written list is what binary VDF writes for it, with no partial file left', async () => {
    putList('100', OWNERS())
    await addToSteam(GALLEON, { home, running: notRunning })
    const written = list('100')
    assert.deepEqual(Buffer.from(writeBinaryVdf(readBinaryVdf(written)!)), Buffer.from(written))
    assert.ok(!readdirSync(config('100')).some((name) => name.includes('partial')))
  })
})
