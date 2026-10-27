import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, test } from 'node:test'
import { log } from '../log.ts'
import { STEAM_COMMAND, launchSteamGame, steamLaunchArgv } from './launch.ts'

function fakeSpawn() {
  const calls: { command: string; args: readonly string[]; options: SpawnOptions }[] = []
  const children: (EventEmitter & { unrefed: boolean })[] = []
  const spawn = (command: string, args: readonly string[], options: SpawnOptions) => {
    calls.push({ command, args, options })
    const child = Object.assign(new EventEmitter(), {
      unrefed: false,
      unref() {
        child.unrefed = true
      }
    })
    children.push(child)
    return child as unknown as ChildProcess
  }
  return { spawn, calls, children }
}

describe('steamLaunchArgv', () => {
  test("hands Steam a rungameid link for the game's appid", () => {
    assert.deepEqual(steamLaunchArgv('1145360'), [STEAM_COMMAND, 'steam://rungameid/1145360'])
  })

  test('an appid that is not digits starts nothing', () => {
    for (const appid of ['', '12a', '1/../2', '1 2', '-1', '1?x=2']) {
      assert.equal(steamLaunchArgv(appid), null, appid)
    }
  })
})

describe('launchSteamGame', () => {
  test('starts the steam command with the link, and returns it', () => {
    const { spawn, calls } = fakeSpawn()
    const argv = launchSteamGame('413150', { spawn, parentEnv: { PATH: '/usr/bin' } })
    assert.deepEqual(argv, ['/usr/bin/steam', 'steam://rungameid/413150'])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, '/usr/bin/steam')
    assert.deepEqual(calls[0].args, ['steam://rungameid/413150'])
  })

  test('does not wait on Steam: no output is read and the child is let go', () => {
    const { spawn, calls, children } = fakeSpawn()
    launchSteamGame('413150', { spawn, parentEnv: {} })
    assert.equal(calls[0].options.stdio, 'ignore')
    assert.equal(children[0].unrefed, true)
  })

  test("uses the clean environment: Galleon's image and Steam's overlay stay behind", () => {
    const { spawn, calls } = fakeSpawn()
    launchSteamGame('413150', {
      spawn,
      parentEnv: {
        APPDIR: '/tmp/.mount_Galleon',
        APPIMAGE: '/home/deck/Galleon.AppImage',
        LD_PRELOAD: '/home/deck/.local/share/Steam/ubuntu12_64/gameoverlayrenderer.so',
        DISPLAY: ':0',
        SteamAppId: '0'
      }
    })
    const env = calls[0].options.env as Record<string, string>
    assert.equal(env.APPDIR, undefined)
    assert.equal(env.APPIMAGE, undefined)
    assert.equal(env.LD_PRELOAD, undefined)
    assert.equal(env.DISPLAY, ':0')
  })

  test('logs the command it hands Steam', (t) => {
    const lines = t.mock.method(log, 'info', () => {})
    const { spawn } = fakeSpawn()
    launchSteamGame('413150', { spawn, parentEnv: {} })
    assert.deepEqual(
      lines.mock.calls.map((call) => call.arguments),
      [
        [
          'steam',
          'launching through Steam',
          { argv: ['/usr/bin/steam', 'steam://rungameid/413150'] }
        ]
      ]
    )
  })

  test('a command that cannot start is logged, not thrown', (t) => {
    const warnings = t.mock.method(log, 'warn', () => {})
    const { spawn, children } = fakeSpawn()
    launchSteamGame('413150', { spawn, parentEnv: {} })
    assert.doesNotThrow(() => children[0].emit('error', new Error('ENOENT')))
    assert.equal(warnings.mock.calls.length, 1)
    assert.equal(warnings.mock.calls[0].arguments[0], 'steam')
  })

  test('an appid that is not one starts nothing', () => {
    const { spawn, calls } = fakeSpawn()
    assert.equal(launchSteamGame('1;reboot', { spawn, parentEnv: {} }), null)
    assert.equal(calls.length, 0)
  })
})
