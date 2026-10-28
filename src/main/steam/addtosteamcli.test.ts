import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { t } from '../i18n.ts'
import type { GalleonShortcut } from './addshortcut.ts'
import { ARMADA_LAUNCH, EXIT, addToSteamCommand, galleonShortcut } from './addtosteamcli.ts'
import type { AddToSteamResult } from './registersteam.ts'

/** Runs the command against a canned result; what it printed, what it asked for, and its code. */
async function run(result: AddToSteamResult | Error, armada = true) {
  const lines: string[] = []
  const asked: GalleonShortcut[] = []
  const code = await addToSteamCommand({
    home: '/home/deck',
    print: (line) => lines.push(line),
    exists: async (path) => armada && path === ARMADA_LAUNCH,
    add: async (shortcut) => {
      asked.push(shortcut)
      if (result instanceof Error) throw result
      return result
    }
  })
  return { code, lines, asked }
}

describe('galleonShortcut', () => {
  test('starts the Steam script install.sh puts in ~/Applications, through armadaOS’s wrapper when it is there', () => {
    assert.deepEqual(galleonShortcut('/home/deck', true), {
      name: 'Galleon',
      exe: '"/home/deck/Applications/galleon-steam.sh"',
      startDir: '"/home/deck/Applications/"',
      launchOptions: '/usr/libexec/armada/armada-game-launch %command%',
      icon: '/home/deck/.local/share/applications/io.github.Rad-Thad.Galleon.svg'
    })
    assert.equal(galleonShortcut('/home/deck', false).launchOptions, '')
  })
})

describe('addToSteamCommand', () => {
  test('Steam running: says to quit it, nothing changed, and its own exit code', async () => {
    const { code, lines } = await run({ outcome: 'steam-running' })
    assert.equal(code, EXIT.steamRunning)
    assert.deepEqual(lines, [t('steam.addSteamRunning')])
  })

  test('no Steam user: says to sign in once', async () => {
    const { code, lines } = await run({ outcome: 'no-steam-user' })
    assert.equal(code, EXIT.noSteamUser)
    assert.deepEqual(lines, [t('steam.addNoSteamUser')])
  })

  test('done: counts the users without naming one, and asks with the wrapper only where it exists', async () => {
    const done = await run({
      outcome: 'done',
      users: [
        { user: '12345678', change: 'added', backup: 'shortcuts.vdf.galleon-backup-x' },
        { user: '87654321', change: 'unchanged' }
      ]
    })
    assert.equal(done.code, EXIT.done)
    assert.deepEqual(done.lines, [
      t('steam.addDone', { count: 2 }),
      t('steam.addBackups'),
      t('steam.addNext')
    ])
    assert.ok(!done.lines.join('\n').match(/12345678|87654321/))
    assert.equal(done.asked[0].launchOptions, `${ARMADA_LAUNCH} %command%`)

    const plain = await run({ outcome: 'done', users: [{ user: '1', change: 'updated' }] }, false)
    assert.equal(plain.asked[0].launchOptions, '')
  })

  test('a list left alone is said and fails the run, even beside a user that was done', async () => {
    const some = await run({
      outcome: 'done',
      users: [
        { user: '1', change: 'added' },
        { user: '2', change: 'unreadable' }
      ]
    })
    assert.equal(some.code, EXIT.unreadable)
    assert.deepEqual(some.lines, [
      t('steam.addDone', { count: 1 }),
      t('steam.addUnreadable', { count: 1 }),
      t('steam.addNext')
    ])

    const none = await run({ outcome: 'done', users: [{ user: '2', change: 'unreadable' }] })
    assert.equal(none.code, EXIT.unreadable)
    assert.deepEqual(none.lines, [t('steam.addUnreadable', { count: 1 })])
  })

  test('a step that throws is said, with the backups, and fails the run', async () => {
    const { code, lines } = await run(new Error('EEXIST'))
    assert.equal(code, EXIT.failed)
    assert.deepEqual(lines, [t('steam.addFailed', { reason: 'EEXIST' })])
  })

  test('every exit code is its own, and only done is zero', () => {
    const codes = Object.values(EXIT)
    assert.equal(new Set(codes).size, codes.length)
    assert.deepEqual(
      Object.entries(EXIT).filter(([, code]) => code === 0),
      [['done', 0]]
    )
  })
})
