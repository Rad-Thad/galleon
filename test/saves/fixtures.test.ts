import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { extractZip } from '../../src/main/zip.ts'
import { ROMS } from '../romm/make-library.mjs'
import {
  ARGOSY_MIN_UPLOAD,
  FIXTURES,
  MANIFEST,
  buildFixtures,
  contentHash,
  differences,
  filesUnder,
  filler,
  writeFixtures,
  zip,
  type FixtureEntry
} from './fixtures.mjs'

const SPEC = readFileSync(resolve(import.meta.dirname, '../../docs/save-sync/SPEC.md'), 'utf8')
const manifest = (): FixtureEntry[] =>
  (JSON.parse(readFileSync(join(FIXTURES, MANIFEST), 'utf8')) as { fixtures: FixtureEntry[] })
    .fixtures
const md5 = (bytes: Buffer): string => createHash('md5').update(bytes).digest('hex')

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'galleon-save-fixtures-'))
}

/**
 * Whether SPEC.md has the section a fixture cites: `3.2` is a numbered
 * heading, `10 PS2` the system's heading inside section 10.
 */
function specHas(reference: string): boolean {
  const headings = SPEC.split('\n').filter((line) => line.startsWith('#'))
  const system = /^(\d+) (.+)$/.exec(reference)
  if (system) {
    const start = headings.findIndex((h) => h.startsWith(`## ${system[1]}. `))
    if (start < 0) return false
    const next = headings.findIndex((h, i) => i > start && h.startsWith('## '))
    return headings
      .slice(start + 1, next < 0 ? undefined : next)
      .some((h) => h === `### ${system[2]}`)
  }
  return headings.some(
    (h) => h.startsWith(`## ${reference}. `) || h.startsWith(`### ${reference} `)
  )
}

/**
 * Personal data a fixture must never carry: addresses, accounts, tokens, and
 * the placeholders the device bridge's sanitiser leaves where it removed a
 * server address or host (tools/device-bridge, `Redactor`), which in a
 * fixture would mean it was made from a real report.
 */
const PERSONAL: [string, RegExp][] = [
  [
    'ipv4',
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/
  ],
  ['ipv6', /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){4,7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])/],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['url', /https?:\/\//i],
  ['romm token', /rmm_[A-Za-z0-9_-]{6,}/],
  ['bearer', /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/],
  ['secret key', /"(?:access_?token|refresh_?token|token|password|secret|api_?key)"\s*:/i],
  ['lan host', /\b[A-Za-z0-9-]+\.(?:local|lan|home|internal|localdomain)\b/i],
  ['home folder', /\/(?:var\/)?home\/[^/\s]+/],
  ['sanitiser placeholder', /<(?:server|host|redacted|token|ip|email)>/]
]

function personalData(bytes: Buffer): string[] {
  const text = bytes.toString('latin1')
  return PERSONAL.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

test('the committed fixtures are what fixtures.mjs builds, byte for byte', () => {
  assert.deepEqual(differences(), [])
  assert.deepEqual(
    filesUnder(FIXTURES),
    [...manifest().map((f) => f.path), MANIFEST].sort(),
    'a file under test/fixtures/saves that the manifest does not list'
  )
})

test('a changed, missing or stray fixture is named', () => {
  const root = scratch()
  try {
    assert.equal(writeFixtures(root), buildFixtures().length)
    assert.deepEqual(differences(root), [])
    const [first, second] = manifest()
    writeFileSync(join(root, first.path), Buffer.from('changed'))
    rmSync(join(root, second.path))
    writeFileSync(join(root, 'snes', 'stray.srm'), Buffer.alloc(200))
    assert.deepEqual(
      differences(root).sort(),
      [
        `${first.path}: bytes differ`,
        `${second.path}: missing`,
        'snes/stray.srm: not built by fixtures.mjs'
      ].sort()
    )
    assert.deepEqual(differences(join(root, 'nowhere')), [
      `${join(root, 'nowhere')} does not exist`
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every fixture names SPEC.md sections that exist, its system among them', () => {
  for (const fixture of manifest()) {
    assert.ok(fixture.spec.length > 0, `${fixture.path} names no section`)
    for (const reference of fixture.spec) {
      assert.ok(specHas(reference), `${fixture.path}: SPEC.md has no section "${reference}"`)
    }
    assert.ok(
      fixture.spec.some((reference) => reference.startsWith('10 ')),
      `${fixture.path} names no system under section 10`
    )
  }
  assert.equal(specHas('10 Atari'), false)
  assert.equal(specHas('99'), false)
  assert.equal(specHas('99 SNES'), false)
})

test('the section check reads headings, not prose', () => {
  assert.equal(specHas('3.2'), true)
  assert.equal(specHas('10 PS2'), true)
  assert.equal(specHas('12'), true)
  // Named in section 11's prose, but a heading only in section 10.
  assert.equal(specHas('11 SNES'), false)
})

test('every fixture is a save Argosy would upload, named and tagged as the spec says', () => {
  const systems = new Set(manifest().map((f) => f.system))
  for (const system of ['snes', 'gba', 'ps1', 'psp', 'ps2', 'ngc', 'wii', 'dc']) {
    assert.ok(systems.has(system), `no fixture for ${system}`)
  }
  for (const fixture of manifest()) {
    const bytes = readFileSync(join(FIXTURES, fixture.path))
    assert.equal(bytes.length, fixture.bytes, fixture.path)
    assert.equal(md5(bytes), fixture.md5, fixture.path)
    assert.ok(
      bytes.length >= ARGOSY_MIN_UPLOAD,
      `${fixture.path} is too small for Argosy to upload`
    )
    assert.equal(fixture.slot, 'autosave', fixture.path)
    assert.ok(
      SPEC.includes(`\`${fixture.emulator}\``),
      `${fixture.emulator} is not a tag in SPEC.md`
    )
    // Section 3.2: the ROM's name without its extension, then the save's.
    const rom = fixture.rom
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
    assert.equal(fixture.uploadName.replace(/\.[^.]+$/, ''), rom, fixture.path)
    assert.equal(fixture.path.split('/').pop(), fixture.uploadName)
    assert.equal(fixture.shape === 'zip', fixture.uploadName.endsWith('.zip'), fixture.path)
  }
})

test('every fixture belongs to a ROM in the Docker library', () => {
  const libraryRoms = new Set(ROMS.flatMap((path) => [path, path.replace(/\/[^/]+$/, '')]))
  // Wii joins the Docker library with the round-trip harness, which needs it.
  const pending = new Set(['roms/wii/Galleon Test Remote (USA).iso'])
  for (const fixture of manifest()) {
    if (pending.has(fixture.rom)) continue
    assert.ok(libraryRoms.has(fixture.rom), `${fixture.rom} is not in make-library.mjs`)
  }
})

test("a zip fixture unpacks with the app's own reader to the entries the manifest lists", async () => {
  for (const fixture of manifest().filter((f) => f.shape === 'zip')) {
    const dir = scratch()
    try {
      const names = await extractZip(join(FIXTURES, fixture.path), dir)
      assert.deepEqual(
        names.map((name) => relative(dir, name).split(sep).join('/')).sort(),
        fixture.entries!.map((e) => e.name).sort(),
        fixture.path
      )
      const unpacked = fixture.entries!.map((e) => {
        const data = readFileSync(join(dir, e.name))
        assert.equal(md5(data), e.md5, `${fixture.path}: ${e.name}`)
        assert.equal(data.length, e.bytes, `${fixture.path}: ${e.name}`)
        return { name: e.name, data }
      })
      assert.equal(contentHash(unpacked, Buffer.alloc(0)), fixture.contentHash, fixture.path)
      // Section 10: no folder entries, and no `PSP/` or `SAVEDATA/` above PSP's roots.
      assert.ok(
        fixture.entries!.every((e) => !e.name.endsWith('/')),
        fixture.path
      )
      if (fixture.system === 'psp') {
        assert.ok(fixture.entries!.every((e) => /^GTST00001[A-Z0-9]+\//.test(e.name)))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test("a raw fixture's content_hash is the MD5 of its bytes", () => {
  for (const fixture of manifest().filter((f) => f.shape === 'raw')) {
    assert.equal(fixture.contentHash, fixture.md5, fixture.path)
    assert.equal(fixture.entries, undefined, fixture.path)
  }
})

test('the zip hash sorts entries by name, skips folders and is order-independent', () => {
  const a = { name: 'b/2.bin', data: Buffer.from('two') }
  const b = { name: 'a/1.bin', data: Buffer.from('one') }
  const expected = md5(Buffer.from(`a/1.bin:${md5(b.data)}\nb/2.bin:${md5(a.data)}`, 'utf8'))
  assert.equal(contentHash([a, b], Buffer.alloc(0)), expected)
  assert.equal(
    contentHash([b, a, { name: 'a/', data: Buffer.alloc(0) }], Buffer.alloc(0)),
    expected
  )
  assert.equal(contentHash(null, Buffer.from('raw')), md5(Buffer.from('raw')))
})

test('the zip writer is stable and says nothing about when it ran', () => {
  const entries = [{ name: 'x/y.bin', data: filler('stable', 300) }]
  assert.ok(zip(entries).equals(zip(entries)))
  assert.ok(filler('a', 40).equals(filler('a', 40)))
  assert.ok(!filler('a', 40).equals(filler('b', 40)))
  assert.equal(filler('a', 40).length, 40)
})

test('no fixture carries personal data', () => {
  for (const file of filesUnder(FIXTURES)) {
    assert.deepEqual(personalData(readFileSync(join(FIXTURES, file))), [], file)
  }
})

test('the personal-data scan finds each kind it looks for', () => {
  const planted: [string, string][] = [
    ['ipv4', 'saved from 192.168.1.20 today'],
    ['ipv6', 'fe80:0:0:0:1:2:3:4'],
    ['email', 'player@example.org'],
    ['url', 'see http://anything'],
    ['romm token', 'rmm_abcdef123456'],
    ['bearer', 'Authorization: Bearer abcdefgh12345678'],
    ['jwt', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0'],
    ['secret key', '{"password": "x"}'],
    ['lan host', 'nas.local'],
    ['home folder', '/home/someone/saves'],
    ['sanitiser placeholder', 'GET <server>/api/saves']
  ]
  assert.deepEqual(
    planted.map(([name]) => name),
    PERSONAL.map(([name]) => name)
  )
  for (const [name, sample] of planted) {
    const embedded = Buffer.concat([filler(name, 200), Buffer.from(` ${sample} `, 'latin1')])
    assert.ok(personalData(embedded).includes(name), `${name} not found in "${sample}"`)
  }
  assert.deepEqual(personalData(Buffer.from('127 bytes in 1.2.3 blocks')), [])
})
