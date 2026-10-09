import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { extractZip } from './zip.ts'
import {
  environment,
  LAUNCHES,
  launches,
  LOG_TAIL_BYTES,
  perfSummaries,
  REPORT_LIMIT,
  reportName,
  settingsServer,
  tail,
  writeReport
} from './report.ts'

/**
 * The report written against a root laid out as a real one is, with
 * credentials beside the settings: what comes out is read back from the zip,
 * so these see what someone handed the report would see.
 */

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'galleon-report-'))
  dirs.push(root)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

async function unpack(zip: string): Promise<Record<string, string>> {
  const out = mkdtempSync(join(tmpdir(), 'galleon-report-out-'))
  dirs.push(out)
  const files = await extractZip(zip, out)
  return Object.fromEntries(
    files.map((file) => [file.slice(out.length + 1), readFileSync(file, 'utf8')])
  )
}

const line = (area: string, message: string): string =>
  `2026-10-09T10:00:00.000Z INFO  ${area.padEnd(10)} ${message}`

const SERVER = 'https://romm.home.example'

test('the report carries its parts, and nothing from config/ but redacted settings', async () => {
  const root = tree({
    'config/settings.json': JSON.stringify({ server: { baseUrl: SERVER, authMode: 'token' } }),
    'config/credentials.bin': 'rmm_supersecret',
    'config/keyring/secret': 'keyring data',
    'logs/app.log': [
      line('romm', `GET ${SERVER}/api from 192.168.1.9`),
      line('perf', 'summary {"screen":"library"}')
    ].join('\n'),
    'logs/launcher.log': 'launcher started\n',
    'etc/os-release': 'NAME="armadaOS"\n',
    'proc/sys/kernel/osrelease': '6.6.0-armada\n'
  })
  const zip = await writeReport({
    root,
    serverUrl: SERVER,
    versions: { app: '0.1.0', commit: 'abc', channel: 'nightly', electron: '44', chrome: '140' },
    sections: {
      power: () => ({ governor: 'schedutil' }),
      preflight: async () => [{ check: 'logs', ok: true }],
      broken: () => {
        throw new Error('no probe')
      }
    },
    env: {
      GALLEON_HOME: root,
      LANG: 'en_US.UTF-8',
      GALLEON_TOKEN: 'x',
      HOME: '/home/u',
      PATH: '/bin'
    },
    systemRoot: root,
    now: new Date('2026-10-09T16:27:01.123Z')
  })

  assert.equal(zip, join(root, 'reports', '2026-10-09T16-27-01Z.zip'))
  assert.deepEqual(
    readdirSync(join(root, 'reports')),
    ['2026-10-09T16-27-01Z.zip'],
    'staging is cleaned up'
  )
  const files = await unpack(zip)
  assert.deepEqual(Object.keys(files).toSorted(), [
    'broken.json',
    'environment.json',
    'launches.log',
    'logs/app.log',
    'logs/launcher.log',
    'perf.log',
    'power.json',
    'preflight.json',
    'settings.json',
    'system.json',
    'versions.json'
  ])
  const everything = Object.values(files).join('\n')
  assert.ok(!everything.includes('romm.home.example'))
  assert.ok(!everything.includes('192.168.1.9'))
  assert.ok(!everything.includes('supersecret'))
  assert.ok(!everything.includes('keyring data'))
  assert.match(files['settings.json'], /<server>/)
  assert.deepEqual(JSON.parse(files['broken.json']), { error: 'no probe' })
  assert.deepEqual(JSON.parse(files['environment.json']), {
    GALLEON_HOME: root,
    LANG: 'en_US.UTF-8'
  })
  assert.equal(JSON.parse(files['system.json']).kernel, '6.6.0-armada')
  assert.equal(JSON.parse(files['versions.json']).channel, 'nightly')
  assert.match(files['perf.log'], /perf\s+summary \{"screen":"library"\}/)
})

test('signed out, the host the settings name is still hidden', async () => {
  const root = tree({
    'config/settings.json': JSON.stringify({ server: { baseUrl: SERVER } }),
    'logs/app.log': line('romm', `GET ${SERVER}/api`)
  })
  const files = await unpack(
    await writeReport({ root, serverUrl: null, versions: {}, env: {}, systemRoot: root })
  )
  assert.ok(!Object.values(files).join('\n').includes('romm.home.example'))
  assert.equal(settingsServer('not json'), null)
  assert.equal(settingsServer('{"server":{}}'), null)
})

test('a root with no logs and no settings still makes a report', async () => {
  const root = tree({})
  const files = await unpack(
    await writeReport({ root, serverUrl: null, versions: {}, env: {}, systemRoot: root })
  )
  assert.ok(files['versions.json'])
  assert.ok(!('settings.json' in files))
  assert.equal(JSON.parse(files['system.json']).osRelease, null)
})

test('logs far past the limit are cut to their tail and the report stays under it', async () => {
  const filler = `${line('romm', 'x'.repeat(200))}\n`
  const big =
    filler.repeat(Math.ceil((REPORT_LIMIT * 1.5) / filler.length)) + line('app', 'the last line')
  const root = tree({ 'logs/app.log': big, 'logs/launcher.log': big })
  const zip = await writeReport({ root, serverUrl: null, versions: {}, env: {}, systemRoot: root })
  assert.ok(statSync(zip).size < REPORT_LIMIT)
  const files = await unpack(zip)
  assert.ok(Object.values(files).join('').length < REPORT_LIMIT, 'even uncompressed')
  assert.ok(files['logs/app.log'].length <= LOG_TAIL_BYTES)
  assert.ok(files['logs/app.log'].endsWith('the last line'))
  assert.ok(files['logs/app.log'].startsWith('2026-'), 'the cut starts at a whole line')
})

test('tail reads a short file whole, and an unreadable one as nothing', async () => {
  const root = tree({ a: 'one\ntwo\n' })
  assert.equal(await tail(join(root, 'a'), 100), 'one\ntwo\n')
  assert.equal(await tail(join(root, 'a'), 5), 'two\n')
  assert.equal(await tail(join(root, 'missing'), 5), null)
})

test('the last launches come with the lines that followed each, and nothing else', () => {
  const log: string[] = []
  for (let n = 1; n <= LAUNCHES + 2; n++) {
    log.push(line('launch', `starting {"romId":${n}}`))
    log.push(line('romm', 'unrelated'))
    log.push(line('emulator', `process spawned {"command":"emu ${n}"}`))
    log.push(line('launch', `session ended {"romId":${n}}`))
  }
  const got = launches(log.join('\n'))
  assert.equal(got.filter((l) => l.includes('starting')).length, LAUNCHES)
  assert.match(got[0], /"romId":3/)
  assert.ok(got.every((l) => !l.includes('unrelated')))
  assert.match(got.at(-1) ?? '', /session ended \{"romId":7\}/)
  assert.deepEqual(launches(line('romm', 'nothing launched')), [])
})

test('perf summaries are picked from the log in the shape the log writes them', () => {
  const log = [
    line('perf', 'summary {"screen":"a"}'),
    line('romm', 'x'),
    line('romm', 'a perf summary mentioned in passing'),
    line('perf', 'summary {"screen":"b"}')
  ]
  assert.deepEqual(perfSummaries(log.join('\n')), [log[0], log[3]])
})

test('only named variables go in, and none whose name says secret', () => {
  assert.deepEqual(
    environment({
      XDG_SESSION_TYPE: 'x11',
      DISPLAY: ':0',
      ROMMIX_AUTH: 'a',
      AWS_SECRET: 's',
      USER: 'u',
      SDL_X: undefined
    }),
    { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }
  )
})

test('a report name sorts by time and is a legal file name', () => {
  assert.equal(reportName(new Date('2026-01-02T03:04:05.678Z')), '2026-01-02T03-04-05Z.zip')
})

test('a second report in the same second is kept beside the first, not over it', async () => {
  const root = tree({})
  const now = new Date('2026-01-02T03:04:05.678Z')
  const input = { root, serverUrl: null, versions: {}, env: {}, systemRoot: root, now }
  const first = await writeReport(input)
  const second = await writeReport(input)
  assert.notEqual(second, first)
  assert.deepEqual(readdirSync(join(root, 'reports')).toSorted(), [
    '2026-01-02T03-04-05Z-2.zip',
    '2026-01-02T03-04-05Z.zip'
  ])
})
