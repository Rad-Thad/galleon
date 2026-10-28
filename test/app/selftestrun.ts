import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after } from 'node:test'
import { electronBinary, seed } from './driver.ts'
import { REQUEST_FILE, RUN_CHECKS } from '../../src/main/selftest.ts'

/**
 * The built app given a self-test request, as run.sh gives it on the Nova, and
 * a fake Armada for the checks that read or switch the power profile. Shared
 * by the pull request's self-test suite and the nightly one.
 */

/** Start-up, the run and the quit together, on a slow CI runner. */
export const EXIT_TIMEOUT_MS = 60_000

export const homes: string[] = []
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

export async function runWithRequest(
  request: Record<string, unknown>,
  server?: { baseUrl: string; token: string; settings?: Record<string, unknown> },
  timeoutMs = EXIT_TIMEOUT_MS,
  env: Record<string, string> = {}
): Promise<{
  code: number | null
  home: string
  results: string
}> {
  const home = mkdtempSync(join(tmpdir(), 'galleon-selftest-app-'))
  homes.push(home)
  const results = join(home, 'results')
  if (server)
    seed(home, { baseUrl: server.baseUrl, token: server.token, settings: server.settings })
  writeFileSync(join(home, REQUEST_FILE), JSON.stringify({ ...request, resultsDir: results }))
  const child = spawn(electronBinary(), ['.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GALLEON_HOME: home,
      XDG_CONFIG_HOME: join(home, 'xdg-config'),
      FLATPAK_SYSTEM_DIR: join(home, 'flatpak-system'),
      FLATPAK_USER_DIR: join(home, 'flatpak-user'),
      ...env
    }
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`the self-test never quit:\n${output}`))
    }, timeoutMs)
    child.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
  return { code, home, results }
}

export const REQUEST = {
  schema: 1,
  sha: 'b'.repeat(40),
  budgetSeconds: 600,
  handshakeDir: null,
  checks: [RUN_CHECKS.complete, 'graphics.modes'],
  profiles: ['performance'],
  payloads: {},
  fakeRomm: null,
  readOnlyServer: true,
  privacy: true,
  abortOnInput: true,
  screenshots: []
}

export function armada(): { root: string; bin: string; setProfile: (name: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'galleon-selftest-power-'))
  homes.push(root)
  const write = (path: string, body: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  const policy = 'sys/devices/system/cpu/cpufreq/policy7'
  const conf = join(import.meta.dirname, '..', '..', 'src', 'main', 'fixtures', 'armada')
  mkdirSync(join(root, 'usr/share/armada'), { recursive: true })
  copyFileSync(
    join(conf, 'power-profiles.conf'),
    join(root, 'usr/share/armada/power-profiles.conf')
  )
  write('sys/class/devfreq/3d00000.gpu/governor', 'msm-adreno-tz\n')
  write('sys/class/devfreq/3d00000.gpu/cur_freq', '220000000\n')
  write('sys/class/devfreq/3d00000.gpu/max_freq', '680000000\n')
  const setProfile = (name: string): void => {
    const balanced = name === 'balanced'
    write(`${policy}/scaling_governor`, balanced ? 'conservative\n' : 'performance\n')
    write(`${policy}/scaling_cur_freq`, balanced ? '595200\n' : '2956800\n')
    write(`${policy}/scaling_max_freq`, balanced ? '2092800\n' : '2956800\n')
    write('profile', `${name}\n`)
  }
  const bin = join(root, 'bin')
  write(
    'bin/armada-power',
    [
      '#!/bin/sh',
      '[ "$1" = status ] || exit 2',
      "printf 'profile=%s\\ncpu_caps={0: 2016000, 7: %s}\\n' \\",
      `  "$(cat '${root}/profile')" "$(cat '${root}/${policy}/scaling_max_freq')"`
    ].join('\n') + '\n'
  )
  chmodSync(join(bin, 'armada-power'), 0o755)
  return { root, bin, setProfile }
}
